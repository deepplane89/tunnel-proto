using System;

namespace JetHorizon.Simulation
{
    public readonly struct TerrainWorldSectionSnapshot
    {
        public int Id { get; }
        public TerrainRegionKind Region { get; }
        public float Distance { get; }
        public float Z { get; }
        public float LeftShoreX { get; }
        public float RightShoreX { get; }
        public float LeftHeight { get; }
        public float RightHeight { get; }
        public float LeftDepth { get; }
        public float RightDepth { get; }

        internal TerrainWorldSectionSnapshot(
            TerrainWorldSection source,
            float worldStartDistance,
            float runDistance,
            float shipZ)
        {
            Id = source.Id;
            Region = source.Region;
            Distance = source.Distance;
            Z = shipZ - ((worldStartDistance + source.Distance) - runDistance);
            LeftShoreX = source.LeftShoreX;
            RightShoreX = source.RightShoreX;
            LeftHeight = source.LeftHeight;
            RightHeight = source.RightHeight;
            LeftDepth = source.LeftDepth;
            RightDepth = source.RightDepth;
        }
    }

    public readonly struct TerrainWorldFeatureSnapshot
    {
        public int Id { get; }
        public TerrainWorldFeatureKind Kind { get; }
        public float Distance { get; }
        public float Z { get; }
        public float CenterX { get; }
        public float HalfWidth { get; }
        public float Height { get; }
        public float CollisionHalfDepth { get; }
        public TraversalRequirement Requirement { get; }
        public int Seed { get; }

        internal TerrainWorldFeatureSnapshot(
            TerrainWorldFeature source,
            float worldStartDistance,
            float runDistance,
            float shipZ)
        {
            Id = source.Id;
            Kind = source.Kind;
            Distance = source.Distance;
            Z = shipZ - ((worldStartDistance + source.Distance) - runDistance);
            CenterX = source.CenterX;
            HalfWidth = source.HalfWidth;
            Height = source.Height;
            CollisionHalfDepth = source.CollisionHalfDepth;
            Requirement = source.Requirement;
            Seed = source.Seed;
        }
    }

    public readonly struct TerrainRouteSectionSnapshot
    {
        public TerrainRouteKind Kind { get; }
        public float Distance { get; }
        public float Z { get; }
        public float LeftX { get; }
        public float RightX { get; }
        public float CeilingHeight { get; }

        internal TerrainRouteSectionSnapshot(
            TerrainRouteSection source,
            float worldStartDistance,
            float runDistance,
            float shipZ)
        {
            Kind = source.Kind;
            Distance = source.Distance;
            Z = shipZ - ((worldStartDistance + source.Distance) - runDistance);
            LeftX = source.LeftX;
            RightX = source.RightX;
            CeilingHeight = source.CeilingHeight;
        }
    }

    public readonly struct TerrainWorldState
    {
        public string WorldId { get; }
        public int Sector { get; }
        public int Heat { get; }
        public TerrainRegionKind ActiveRegion { get; }
        public int ActiveRegionIndex { get; }
        public float RegionProgress01 { get; }
        public float WorldStartDistance { get; }
        public float WorldLength { get; }
        public float EarnedSpeedBonus { get; }
        public float SoftSpeedCap { get; }
        public bool ExtractionDecisionOpen { get; }
        public float ExtractionDistance { get; }

        internal TerrainWorldState(
            TerrainWorldPlan world,
            int heat,
            int activeRegionIndex,
            float regionProgress01,
            float earnedSpeedBonus,
            float softSpeedCap,
            bool extractionDecisionOpen)
        {
            WorldId = world?.Id ?? string.Empty;
            Sector = world?.Sector ?? 0;
            Heat = heat;
            ActiveRegionIndex = activeRegionIndex;
            ActiveRegion = world != null && activeRegionIndex >= 0 && activeRegionIndex < world.RegionCount
                ? world.GetRegion(activeRegionIndex).Kind
                : TerrainRegionKind.OpenSea;
            RegionProgress01 = regionProgress01;
            WorldStartDistance = world?.StartDistance ?? 0f;
            WorldLength = world?.Length ?? 0f;
            EarnedSpeedBonus = earnedSpeedBonus;
            SoftSpeedCap = softSpeedCap;
            ExtractionDecisionOpen = extractionDecisionOpen;
            ExtractionDistance = world == null
                ? 0f
                : world.StartDistance + world.GetRegion(world.RegionCount - 1).StartDistance;
        }
    }

    public readonly struct TerrainWorldTickResult
    {
        public bool RegionChanged { get; }
        public TerrainRegionKind Region { get; }
        public bool BeginLightning { get; }
        public bool BeginPrismatic { get; }
        public bool ExtractionDecisionOpened { get; }
        public bool CollisionEntered { get; }
        public int CollisionEntityId { get; }
        public float CollisionCenterX { get; }

        internal TerrainWorldTickResult(
            bool regionChanged,
            TerrainRegionKind region,
            bool beginLightning,
            bool beginPrismatic,
            bool extractionDecisionOpened,
            bool collisionEntered,
            int collisionEntityId,
            float collisionCenterX)
        {
            RegionChanged = regionChanged;
            Region = region;
            BeginLightning = beginLightning;
            BeginPrismatic = beginPrismatic;
            ExtractionDecisionOpened = extractionDecisionOpened;
            CollisionEntered = collisionEntered;
            CollisionEntityId = collisionEntityId;
            CollisionCenterX = collisionCenterX;
        }
    }

    /// <summary>
    /// Owns region cadence, extraction and collision against actual shore topology.
    /// It contains no meshes, materials, transforms, prefabs or host-engine concepts.
    /// </summary>
    public sealed class TerrainWorldRuntime
    {
        const float ShoreCollisionVisualInset = 2f;
        const float NextWorldPreloadDistance = 1800f;

        readonly ShipCapabilityProfile _capability;
        TerrainWorldPlan _world;
        TerrainWorldPlan _queuedWorld;
        bool _continueQueued;
        int _activeRegionIndex;
        int _heat;
        float _earnedSpeedBonus;
        bool _extractionDecisionOpen;
        int _activeCollisionId;
        TerrainWorldState _snapshot;

        public TerrainWorldPlan World => _world;
        public TerrainWorldPlan QueuedWorld => _queuedWorld;
        public TerrainWorldState Snapshot => _snapshot;
        public float EarnedSpeedBonus => _earnedSpeedBonus;
        public float SoftSpeedCap => TerrainWorldPaceRules.MaximumSpeedForHeat(_heat);
        public int Heat => _heat;
        public bool ExtractionDecisionOpen => _extractionDecisionOpen;
        public float CurrentRegionStartDistance => _world.StartDistance
            + _world.GetRegion(_activeRegionIndex).StartDistance;

        public TerrainWorldRuntime(ShipCapabilityProfile capability)
        {
            _capability = capability;
            Reset();
        }

        public void Reset()
        {
            _heat = 0;
            _earnedSpeedBonus = 0f;
            _activeRegionIndex = 0;
            _extractionDecisionOpen = false;
            _activeCollisionId = 0;
            _queuedWorld = null;
            _continueQueued = false;
            _world = TerrainWorldCatalog.CreateProofWorld(0, 0f, _capability);
            Refresh(0f);
        }

        public bool TryAcceptExtraction(SimulationEventBuffer events)
        {
            if (!_extractionDecisionOpen || events == null) return false;
            _extractionDecisionOpen = false;
            events.Add(new SimulationEvent(
                SimulationEventType.ExtractionDecisionResolved,
                _world.Sector,
                1f,
                _heat));
            Refresh(_world.EndDistance);
            return true;
        }

        public bool TryContinueDeeper(float runDistance, SimulationEventBuffer events)
        {
            if (!_extractionDecisionOpen || events == null) return false;
            _extractionDecisionOpen = false;
            _heat = Math.Min(5, _heat + 1);
            _queuedWorld = TerrainWorldCatalog.CreateProofWorld(
                _world.Sector + 1,
                _world.EndDistance,
                _capability);
            _continueQueued = true;
            events.Add(new SimulationEvent(
                SimulationEventType.ExtractionDecisionResolved,
                _queuedWorld.Sector,
                0f,
                _heat));
            Refresh(runDistance);
            return true;
        }

        public TerrainWorldTickResult Tick(
            float runDistance,
            float shipX,
            float rollRadians,
            float rollMaximumRadians,
            bool collisionSuppressed,
            SimulationEventBuffer events)
        {
            if (events == null) throw new ArgumentNullException(nameof(events));
            if (_continueQueued && runDistance >= _world.EndDistance)
            {
                _world = _queuedWorld;
                _queuedWorld = null;
                _continueQueued = false;
                _activeRegionIndex = 0;
                _activeCollisionId = 0;
                events.Add(new SimulationEvent(
                    SimulationEventType.SectorChanged,
                    _world.Sector,
                    _heat,
                    _world.EndDistance));
            }
            // Presentation needs the next complete landmass well before the seam.
            // Queueing is core state, not a Unity guess, and does not change the
            // active collision world until the existing end-distance handoff.
            if (!_continueQueued
                && runDistance >= _world.EndDistance - NextWorldPreloadDistance)
            {
                _queuedWorld = TerrainWorldCatalog.CreateProofWorld(
                    _world.Sector + 1,
                    _world.EndDistance,
                    _capability);
                _continueQueued = true;
            }
            float localDistance = runDistance - _world.StartDistance;
            int nextRegion = FindRegion(localDistance);
            bool regionChanged = nextRegion != _activeRegionIndex;
            bool beginLightning = false;
            bool beginPrismatic = false;
            bool extractionOpened = false;
            if (regionChanged)
            {
                while (_activeRegionIndex < nextRegion)
                {
                    _earnedSpeedBonus += _world.GetRegion(_activeRegionIndex).CompletionSpeedReward;
                    _activeRegionIndex++;
                }
                TerrainWorldRegion active = _world.GetRegion(_activeRegionIndex);
                beginLightning = active.Kind == TerrainRegionKind.StormChannel;
                beginPrismatic = active.Kind == TerrainRegionKind.PrismaticReach;
                events.Add(new SimulationEvent(
                    SimulationEventType.TerrainRegionChanged,
                    active.Id,
                    (float)active.Kind,
                    _earnedSpeedBonus));
                if (active.Kind == TerrainRegionKind.ExtractionBreather)
                {
                    // Extraction UI is intentionally disabled during gameplay-loop
                    // development. The authored open-water region is a real breather;
                    // queue the next world without pausing or deleting presentation.
                    _heat = Math.Min(5, _heat + 1);
                    if (_queuedWorld == null)
                    {
                        _queuedWorld = TerrainWorldCatalog.CreateProofWorld(
                            _world.Sector + 1,
                            _world.EndDistance,
                            _capability);
                        _continueQueued = true;
                    }
                }
            }

            bool collision = false;
            int collisionId = 0;
            float collisionCenter = 0f;
            if (!collisionSuppressed
                && TryGetCollision(
                    localDistance,
                    shipX,
                    rollRadians,
                    rollMaximumRadians,
                    out collisionId,
                    out collisionCenter))
            {
                collision = collisionId != _activeCollisionId;
                _activeCollisionId = collisionId;
            }
            else
            {
                _activeCollisionId = 0;
            }

            Refresh(runDistance);
            return new TerrainWorldTickResult(
                regionChanged,
                _world.GetRegion(_activeRegionIndex).Kind,
                beginLightning,
                beginPrismatic,
                extractionOpened,
                collision,
                collisionId,
                collisionCenter);
        }

        public bool TryGetUpcomingPrismatic(float runDistance, out float absoluteStartDistance)
        {
            if (!TryGetRegionStart(TerrainRegionKind.PrismaticReach, out absoluteStartDistance))
                return false;
            return absoluteStartDistance > runDistance;
        }

        public bool TryGetRegionStart(TerrainRegionKind kind, out float absoluteStartDistance)
        {
            for (int i = 0; i < _world.RegionCount; i++)
            {
                TerrainWorldRegion region = _world.GetRegion(i);
                if (region.Kind != kind) continue;
                absoluteStartDistance = _world.StartDistance + region.StartDistance;
                return true;
            }
            absoluteStartDistance = 0f;
            return false;
        }

        public void GetActiveSafeWindow(out float centerX, out float halfWidth)
        {
            TerrainWorldRegion region = _world.GetRegion(_activeRegionIndex);
            SampleShore(region.StartDistance + region.Length * .5f, out float left, out float right);
            centerX = (left + right) * .5f;
            halfWidth = (right - left) * .5f;
        }

        public int WriteSections(
            float runDistance,
            float shipZ,
            TerrainWorldSectionSnapshot[] destination)
        {
            if (destination == null) throw new ArgumentNullException(nameof(destination));
            int count = Math.Min(destination.Length, _world.SectionCount);
            for (int i = 0; i < count; i++)
                destination[i] = new TerrainWorldSectionSnapshot(
                    _world.GetSection(i),
                    _world.StartDistance,
                    runDistance,
                    shipZ);
            return count;
        }

        public int WriteFeatures(
            float runDistance,
            float shipZ,
            TerrainWorldFeatureSnapshot[] destination)
        {
            if (destination == null) throw new ArgumentNullException(nameof(destination));
            int count = Math.Min(destination.Length, _world.FeatureCount);
            for (int i = 0; i < count; i++)
                destination[i] = new TerrainWorldFeatureSnapshot(
                    _world.GetFeature(i),
                    _world.StartDistance,
                    runDistance,
                    shipZ);
            return count;
        }

        public int WriteRouteSections(
            float runDistance,
            float shipZ,
            TerrainRouteSectionSnapshot[] destination)
        {
            if (destination == null) throw new ArgumentNullException(nameof(destination));
            int count = Math.Min(destination.Length, _world.RouteSectionCount);
            for (int i = 0; i < count; i++)
                destination[i] = new TerrainRouteSectionSnapshot(
                    _world.GetRouteSection(i),
                    _world.StartDistance,
                    runDistance,
                    shipZ);
            return count;
        }

        public int WriteQueuedSections(
            float runDistance,
            float shipZ,
            TerrainWorldSectionSnapshot[] destination)
        {
            if (destination == null) throw new ArgumentNullException(nameof(destination));
            if (_queuedWorld == null) return 0;
            int count = Math.Min(destination.Length, _queuedWorld.SectionCount);
            for (int i = 0; i < count; i++)
                destination[i] = new TerrainWorldSectionSnapshot(
                    _queuedWorld.GetSection(i),
                    _queuedWorld.StartDistance,
                    runDistance,
                    shipZ);
            return count;
        }

        public int WriteQueuedFeatures(
            float runDistance,
            float shipZ,
            TerrainWorldFeatureSnapshot[] destination)
        {
            if (destination == null) throw new ArgumentNullException(nameof(destination));
            if (_queuedWorld == null) return 0;
            int count = Math.Min(destination.Length, _queuedWorld.FeatureCount);
            for (int i = 0; i < count; i++)
                destination[i] = new TerrainWorldFeatureSnapshot(
                    _queuedWorld.GetFeature(i),
                    _queuedWorld.StartDistance,
                    runDistance,
                    shipZ);
            return count;
        }

        public int WriteQueuedRouteSections(
            float runDistance,
            float shipZ,
            TerrainRouteSectionSnapshot[] destination)
        {
            if (destination == null) throw new ArgumentNullException(nameof(destination));
            if (_queuedWorld == null) return 0;
            int count = Math.Min(destination.Length, _queuedWorld.RouteSectionCount);
            for (int i = 0; i < count; i++)
                destination[i] = new TerrainRouteSectionSnapshot(
                    _queuedWorld.GetRouteSection(i),
                    _queuedWorld.StartDistance,
                    runDistance,
                    shipZ);
            return count;
        }

        int FindRegion(float localDistance)
        {
            if (localDistance <= 0f) return 0;
            for (int i = 0; i < _world.RegionCount; i++)
                if (localDistance < _world.GetRegion(i).EndDistance) return i;
            return _world.RegionCount - 1;
        }

        bool TryGetCollision(
            float localDistance,
            float shipX,
            float rollRadians,
            float rollMaximumRadians,
            out int collisionId,
            out float collisionCenterX)
        {
            SampleShore(localDistance, out float leftShore, out float rightShore);
            float rollFraction = Math.Min(1f, Math.Abs(rollRadians) / Math.Max(.001f, rollMaximumRadians));
            float bodyHalfWidth = _capability.CollisionHalfWidth * .65f;
            float shipHalfWidth = _capability.CollisionHalfWidth
                + (bodyHalfWidth - _capability.CollisionHalfWidth) * rollFraction;
            if (_world.HasRoutePassagesAt(localDistance))
            {
                if (!ContainsShip(TerrainRouteKind.SafeCanyon)
                    && !ContainsShip(TerrainRouteKind.KnifeEdgeTunnel)
                    && !ContainsShip(TerrainRouteKind.CargoChannel))
                {
                    collisionId = 720000 + Math.Max(0, FindSection(localDistance));
                    collisionCenterX = shipX;
                    return true;
                }
                collisionId = 0;
                collisionCenterX = 0f;
                return false;

                bool ContainsShip(TerrainRouteKind kind)
                {
                    if (!_world.TryGetRoutePassage(kind, localDistance, out float left, out float right, out _))
                        return false;
                    // Route walls use the same visual inset convention as the outer
                    // shoreline: collision occurs inside the terrain silhouette,
                    // never in apparently empty water before the faceted wall.
                    return shipX - shipHalfWidth > left - ShoreCollisionVisualInset
                        && shipX + shipHalfWidth < right + ShoreCollisionVisualInset;
                }
            }
            // The presentation's source-parity face has seeded facet displacement.
            // Move gameplay collision slightly into the land so a collision can never
            // occur in water immediately before the visible face reaches the ship.
            float leftCollision = leftShore - ShoreCollisionVisualInset;
            float rightCollision = rightShore + ShoreCollisionVisualInset;
            if (shipX - shipHalfWidth <= leftCollision || shipX + shipHalfWidth >= rightCollision)
            {
                collisionId = 700000 + Math.Max(0, FindSection(localDistance));
                collisionCenterX = (leftShore + rightShore) * .5f;
                return true;
            }
            for (int i = 0; i < _world.FeatureCount; i++)
            {
                TerrainWorldFeature feature = _world.GetFeature(i);
                if (!TerrainWorldFeatureRules.IsWaterFormation(feature.Kind)) continue;
                // Match the visible boulder's rounded waterline footprint. A small
                // inset keeps collision inside the faceted silhouette instead of in
                // apparently empty water between its widest triangles.
                float radiusX = Math.Max(.1f, feature.HalfWidth + shipHalfWidth - 1.25f);
                float radiusZ = Math.Max(.1f, feature.CollisionHalfDepth + shipHalfWidth - 1.25f);
                float x = (shipX - feature.CenterX) / radiusX;
                float z = (localDistance - feature.Distance) / radiusZ;
                if (x * x + z * z > 1f) continue;
                collisionId = 710000 + feature.Id;
                collisionCenterX = feature.CenterX;
                return true;
            }
            collisionId = 0;
            collisionCenterX = 0f;
            return false;
        }

        void SampleShore(float localDistance, out float leftShore, out float rightShore)
        {
            int index = FindSection(localDistance);
            TerrainWorldSection a = _world.GetSection(index);
            if (index >= _world.SectionCount - 1)
            {
                leftShore = a.LeftShoreX;
                rightShore = a.RightShoreX;
                return;
            }
            TerrainWorldSection b = _world.GetSection(index + 1);
            float t = Math.Max(0f, Math.Min(1f,
                (localDistance - a.Distance) / Math.Max(.001f, b.Distance - a.Distance)));
            leftShore = a.LeftShoreX + (b.LeftShoreX - a.LeftShoreX) * t;
            rightShore = a.RightShoreX + (b.RightShoreX - a.RightShoreX) * t;
        }

        int FindSection(float localDistance)
        {
            if (localDistance <= _world.GetSection(0).Distance) return 0;
            for (int i = 0; i < _world.SectionCount - 1; i++)
                if (localDistance < _world.GetSection(i + 1).Distance) return i;
            return _world.SectionCount - 1;
        }

        void Refresh(float runDistance)
        {
            TerrainWorldRegion region = _world.GetRegion(_activeRegionIndex);
            float local = runDistance - _world.StartDistance;
            float progress = Math.Max(0f, Math.Min(1f,
                (local - region.StartDistance) / region.Length));
            _snapshot = new TerrainWorldState(
                _world,
                _heat,
                _activeRegionIndex,
                progress,
                _earnedSpeedBonus,
                SoftSpeedCap,
                _extractionDecisionOpen);
        }
    }
}
