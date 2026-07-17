using System;

namespace JetHorizon.Simulation
{
    public readonly struct TerrainFormationSnapshot
    {
        public int Id { get; }
        public TerrainFormationKind Kind { get; }
        public TerrainBeatKind Beat { get; }
        public float Distance { get; }
        public float Z { get; }
        public float Length { get; }
        public float CenterX { get; }
        public float HalfWidth { get; }
        public float Radius { get; }
        public float Height { get; }
        public float Depth { get; }
        public int Seed { get; }

        internal TerrainFormationSnapshot(
            TerrainFormationSpec source,
            float courseStartDistance,
            float runDistance,
            float shipZ)
        {
            Id = source.Id;
            Kind = source.Kind;
            Beat = source.Beat;
            Distance = source.Distance;
            Z = shipZ - ((courseStartDistance + source.Distance) - runDistance);
            Length = source.Length;
            CenterX = source.CenterX;
            HalfWidth = source.HalfWidth;
            Radius = source.Radius;
            Height = source.Height;
            Depth = source.Depth;
            Seed = source.Seed;
        }
    }

    public readonly struct TerrainTraversalSnapshot
    {
        public int Id { get; }
        public TerrainBeatKind Beat { get; }
        public TerrainTraversalMode Mode { get; }
        public float Distance { get; }
        public float Z { get; }
        public float CenterX { get; }
        public float HalfWidth { get; }
        public float CollisionHalfDepth { get; }
        public TraversalRequirement Requirement { get; }

        internal TerrainTraversalSnapshot(
            TerrainTraversalSample source,
            float courseStartDistance,
            float runDistance,
            float shipZ)
        {
            Id = source.Id;
            Beat = source.Beat;
            Mode = source.Mode;
            Distance = source.Distance;
            Z = shipZ - ((courseStartDistance + source.Distance) - runDistance);
            CenterX = source.CenterX;
            HalfWidth = source.HalfWidth;
            CollisionHalfDepth = source.CollisionHalfDepth;
            Requirement = source.Requirement;
        }
    }

    public readonly struct TerrainRunState
    {
        public string CourseId { get; }
        public int Sector { get; }
        public int Heat { get; }
        public TerrainBeatKind ActiveBeat { get; }
        public int ActiveBeatIndex { get; }
        public float BeatProgress01 { get; }
        public float CourseStartDistance { get; }
        public float CourseLength { get; }
        public float EarnedSpeedBonus { get; }
        public float SoftSpeedCap { get; }
        public bool ExtractionDecisionOpen { get; }
        public float ExtractionDistance { get; }

        internal TerrainRunState(
            TerrainCoursePlan course,
            int heat,
            int activeBeatIndex,
            float beatProgress01,
            float earnedSpeedBonus,
            float softSpeedCap,
            bool extractionDecisionOpen)
        {
            CourseId = course?.Id ?? string.Empty;
            Sector = course?.Sector ?? 0;
            Heat = heat;
            ActiveBeatIndex = activeBeatIndex;
            ActiveBeat = course != null && activeBeatIndex >= 0 && activeBeatIndex < course.BeatCount
                ? course.GetBeat(activeBeatIndex).Kind
                : TerrainBeatKind.OpenWater;
            BeatProgress01 = beatProgress01;
            CourseStartDistance = course?.StartDistance ?? 0f;
            CourseLength = course?.Length ?? 0f;
            EarnedSpeedBonus = earnedSpeedBonus;
            SoftSpeedCap = softSpeedCap;
            ExtractionDecisionOpen = extractionDecisionOpen;
            ExtractionDistance = course == null
                ? 0f
                : course.StartDistance + course.GetBeat(course.BeatCount - 1).StartDistance;
        }
    }

    public readonly struct TerrainCourseTickResult
    {
        public bool BeatChanged { get; }
        public TerrainBeatKind Beat { get; }
        public bool BeginLightning { get; }
        public bool BeginPrismatic { get; }
        public bool ExtractionDecisionOpened { get; }
        public bool CollisionEntered { get; }
        public int CollisionEntityId { get; }
        public float CollisionCenterX { get; }

        internal TerrainCourseTickResult(
            bool beatChanged,
            TerrainBeatKind beat,
            bool beginLightning,
            bool beginPrismatic,
            bool extractionDecisionOpened,
            bool collisionEntered,
            int collisionEntityId,
            float collisionCenterX)
        {
            BeatChanged = beatChanged;
            Beat = beat;
            BeginLightning = beginLightning;
            BeginPrismatic = beginPrismatic;
            ExtractionDecisionOpened = extractionDecisionOpened;
            CollisionEntered = collisionEntered;
            CollisionEntityId = collisionEntityId;
            CollisionCenterX = collisionCenterX;
        }
    }

    /// <summary>
    /// Owns terrain-beat lifecycle, pace rewards, extraction and collision apertures.
    /// It never creates meshes and does not know which host engine presents the course.
    /// </summary>
    public sealed class TerrainCourseRuntime
    {
        readonly ShipCapabilityProfile _capability;
        TerrainCoursePlan _course;
        int _activeBeatIndex;
        int _heat;
        float _earnedSpeedBonus;
        bool _extractionDecisionOpen;
        int _activeCollisionId;
        TerrainRunState _snapshot;

        public TerrainCoursePlan Course => _course;
        public TerrainRunState Snapshot => _snapshot;
        public float EarnedSpeedBonus => _earnedSpeedBonus;
        public float SoftSpeedCap => 128f + _heat * 12f;
        public int Heat => _heat;
        public bool ExtractionDecisionOpen => _extractionDecisionOpen;
        public float CurrentBeatStartDistance => _course.StartDistance
            + _course.GetBeat(_activeBeatIndex).StartDistance;

        public TerrainCourseRuntime(ShipCapabilityProfile capability)
        {
            _capability = capability;
            Reset();
        }

        public void Reset()
        {
            _heat = 0;
            _earnedSpeedBonus = 0f;
            _activeBeatIndex = 0;
            _extractionDecisionOpen = false;
            _activeCollisionId = 0;
            _course = TerrainCourseCatalog.CreateProofSector(0, 0f, _capability);
            Refresh(0f);
        }

        public bool TryAcceptExtraction(SimulationEventBuffer events)
        {
            if (!_extractionDecisionOpen || events == null) return false;
            _extractionDecisionOpen = false;
            events.Add(new SimulationEvent(
                SimulationEventType.ExtractionDecisionResolved,
                _course.Sector,
                1f,
                _heat));
            Refresh(_course.EndDistance);
            return true;
        }

        public bool TryContinueDeeper(float runDistance, SimulationEventBuffer events)
        {
            if (!_extractionDecisionOpen || events == null) return false;
            _extractionDecisionOpen = false;
            _heat = Math.Min(5, _heat + 1);
            _activeBeatIndex = 0;
            _activeCollisionId = 0;
            float nextStart = runDistance + 120f;
            _course = TerrainCourseCatalog.CreateProofSector(_course.Sector + 1, nextStart, _capability);
            events.Add(new SimulationEvent(
                SimulationEventType.ExtractionDecisionResolved,
                _course.Sector,
                0f,
                _heat));
            events.Add(new SimulationEvent(
                SimulationEventType.SectorChanged,
                _course.Sector,
                _heat,
                _course.EndDistance));
            Refresh(runDistance);
            return true;
        }

        public TerrainCourseTickResult Tick(
            float runDistance,
            float shipX,
            float rollRadians,
            float rollMaximumRadians,
            bool collisionSuppressed,
            SimulationEventBuffer events)
        {
            if (events == null) throw new ArgumentNullException(nameof(events));
            float localDistance = runDistance - _course.StartDistance;
            int nextBeat = FindBeat(localDistance);
            bool beatChanged = nextBeat != _activeBeatIndex;
            bool beginLightning = false;
            bool beginPrismatic = false;
            bool extractionOpened = false;
            if (beatChanged)
            {
                while (_activeBeatIndex < nextBeat)
                {
                    _earnedSpeedBonus += _course.GetBeat(_activeBeatIndex).CompletionSpeedReward;
                    _activeBeatIndex++;
                }
                TerrainCourseBeat active = _course.GetBeat(_activeBeatIndex);
                beginLightning = active.Kind == TerrainBeatKind.LightningPassage;
                beginPrismatic = active.Kind == TerrainBeatKind.PrismaticCorridor;
                events.Add(new SimulationEvent(
                    SimulationEventType.TerrainBeatChanged,
                    active.Id,
                    (float)active.Kind,
                    _earnedSpeedBonus));
                if (active.Kind == TerrainBeatKind.ExtractionBreather)
                {
                    _extractionDecisionOpen = true;
                    extractionOpened = true;
                    events.Add(new SimulationEvent(
                        SimulationEventType.ExtractionDecisionOpened,
                        _course.Sector,
                        _heat,
                        _course.StartDistance + active.StartDistance));
                }
            }

            bool collision = false;
            int collisionId = 0;
            float collisionCenter = 0f;
            if (!collisionSuppressed
                && TryGetCollision(localDistance, shipX, rollRadians, rollMaximumRadians,
                    out collisionId, out collisionCenter))
            {
                collision = collisionId != _activeCollisionId;
                _activeCollisionId = collisionId;
            }
            else
            {
                _activeCollisionId = 0;
            }

            Refresh(runDistance);
            return new TerrainCourseTickResult(
                beatChanged,
                _course.GetBeat(_activeBeatIndex).Kind,
                beginLightning,
                beginPrismatic,
                extractionOpened,
                collision,
                collisionId,
                collisionCenter);
        }

        public bool TryGetUpcomingPrismatic(out float absoluteStartDistance)
        {
            for (int i = _activeBeatIndex; i < _course.BeatCount; i++)
            {
                TerrainCourseBeat beat = _course.GetBeat(i);
                if (beat.Kind != TerrainBeatKind.PrismaticCorridor) continue;
                absoluteStartDistance = _course.StartDistance + beat.StartDistance;
                return true;
            }
            absoluteStartDistance = 0f;
            return false;
        }

        public bool TryGetBeatStart(TerrainBeatKind kind, out float absoluteStartDistance)
        {
            for (int i = 0; i < _course.BeatCount; i++)
            {
                TerrainCourseBeat beat = _course.GetBeat(i);
                if (beat.Kind != kind) continue;
                absoluteStartDistance = _course.StartDistance + beat.StartDistance;
                return true;
            }
            absoluteStartDistance = 0f;
            return false;
        }

        public void GetActiveSafeWindow(out float centerX, out float halfWidth)
        {
            TerrainBeatKind beat = _course.GetBeat(_activeBeatIndex).Kind;
            for (int i = 0; i < _course.TraversalCount; i++)
            {
                TerrainTraversalSample sample = _course.GetTraversal(i);
                if (sample.Beat != beat) continue;
                centerX = sample.CenterX;
                halfWidth = sample.HalfWidth;
                return;
            }
            centerX = 0f;
            halfWidth = 10f;
        }

        public int WriteFormations(
            float runDistance,
            float shipZ,
            TerrainFormationSnapshot[] destination)
        {
            if (destination == null) throw new ArgumentNullException(nameof(destination));
            int count = Math.Min(destination.Length, _course.FormationCount);
            for (int i = 0; i < count; i++)
                destination[i] = new TerrainFormationSnapshot(
                    _course.GetFormation(i),
                    _course.StartDistance,
                    runDistance,
                    shipZ);
            return count;
        }

        public int WriteTraversal(
            float runDistance,
            float shipZ,
            TerrainTraversalSnapshot[] destination)
        {
            if (destination == null) throw new ArgumentNullException(nameof(destination));
            int count = Math.Min(destination.Length, _course.TraversalCount);
            for (int i = 0; i < count; i++)
                destination[i] = new TerrainTraversalSnapshot(
                    _course.GetTraversal(i),
                    _course.StartDistance,
                    runDistance,
                    shipZ);
            return count;
        }

        int FindBeat(float localDistance)
        {
            if (localDistance <= 0f) return 0;
            for (int i = 0; i < _course.BeatCount; i++)
                if (localDistance < _course.GetBeat(i).EndDistance) return i;
            return _course.BeatCount - 1;
        }

        bool TryGetCollision(
            float localDistance,
            float shipX,
            float rollRadians,
            float rollMaximumRadians,
            out int collisionId,
            out float centerX)
        {
            for (int i = 0; i < _course.TraversalCount; i++)
            {
                TerrainTraversalSample sample = _course.GetTraversal(i);
                if (sample.Mode != TerrainTraversalMode.Discrete) continue;
                if (Math.Abs(localDistance - sample.Distance) > sample.CollisionHalfDepth) continue;
                if (Outside(sample.CenterX, sample.HalfWidth, shipX, rollRadians, rollMaximumRadians, sample.Requirement))
                {
                    collisionId = sample.Id;
                    centerX = sample.CenterX;
                    return true;
                }
            }

            for (int i = 0; i < _course.TraversalCount - 1; i++)
            {
                TerrainTraversalSample a = _course.GetTraversal(i);
                TerrainTraversalSample b = _course.GetTraversal(i + 1);
                if (a.Mode != TerrainTraversalMode.Continuous
                    || b.Mode != TerrainTraversalMode.Continuous
                    || a.Beat != b.Beat
                    || localDistance < a.Distance
                    || localDistance > b.Distance)
                    continue;
                float t = (localDistance - a.Distance) / Math.Max(.001f, b.Distance - a.Distance);
                float center = a.CenterX + (b.CenterX - a.CenterX) * t;
                float halfWidth = a.HalfWidth + (b.HalfWidth - a.HalfWidth) * t;
                TraversalRequirement requirement = t < .5f ? a.Requirement : b.Requirement;
                if (Outside(center, halfWidth, shipX, rollRadians, rollMaximumRadians, requirement))
                {
                    collisionId = a.Id;
                    centerX = center;
                    return true;
                }
                break;
            }
            collisionId = 0;
            centerX = 0f;
            return false;
        }

        bool Outside(
            float center,
            float halfWidth,
            float shipX,
            float rollRadians,
            float rollMaximumRadians,
            TraversalRequirement requirement)
        {
            float rollFraction = Math.Min(1f, Math.Abs(rollRadians) / Math.Max(.001f, rollMaximumRadians));
            float bodyHalfWidth = _capability.CollisionHalfWidth * .65f;
            float shipHalfWidth = _capability.CollisionHalfWidth
                + (bodyHalfWidth - _capability.CollisionHalfWidth) * rollFraction;
            float allowed = Math.Max(0f, halfWidth - shipHalfWidth);
            if (Math.Abs(shipX - center) > allowed) return true;
            return requirement == TraversalRequirement.KnifeEdge && rollFraction < .72f;
        }

        void Refresh(float runDistance)
        {
            TerrainCourseBeat beat = _course.GetBeat(_activeBeatIndex);
            float local = runDistance - _course.StartDistance;
            float progress = Math.Max(0f, Math.Min(1f, (local - beat.StartDistance) / beat.Length));
            _snapshot = new TerrainRunState(
                _course,
                _heat,
                _activeBeatIndex,
                progress,
                _earnedSpeedBonus,
                SoftSpeedCap,
                _extractionDecisionOpen);
        }
    }
}
