using System;
using System.Collections.Generic;

namespace JetHorizon.Simulation
{
    public enum TerrainBeatKind
    {
        OpenWater,
        BoulderSlalom,
        LowBankWeave,
        LightningPassage,
        NaturalArch,
        CrystallineCanyon,
        PrismaticCorridor,
        ExtractionBreather
    }

    public enum TerrainFormationKind
    {
        BoulderGate,
        LowBankPair,
        NaturalArch,
        CanyonPair,
        PrismaticCorridor
    }

    public enum TerrainTraversalMode
    {
        Discrete,
        Continuous
    }

    /// <summary>
    /// Engine-neutral intent for one large environmental formation. Unity chooses
    /// meshes, materials and optimized presentation; these values remain gameplay facts.
    /// </summary>
    public readonly struct TerrainFormationSpec
    {
        public int Id { get; }
        public TerrainFormationKind Kind { get; }
        public TerrainBeatKind Beat { get; }
        public float Distance { get; }
        public float Length { get; }
        public float CenterX { get; }
        public float HalfWidth { get; }
        public float Radius { get; }
        public float Height { get; }
        public float Depth { get; }
        public int Seed { get; }

        public TerrainFormationSpec(
            int id,
            TerrainFormationKind kind,
            TerrainBeatKind beat,
            float distance,
            float length,
            float centerX,
            float halfWidth,
            float radius,
            float height,
            float depth,
            int seed)
        {
            if (id <= 0) throw new ArgumentOutOfRangeException(nameof(id));
            if (distance < 0f) throw new ArgumentOutOfRangeException(nameof(distance));
            if (length < 0f) throw new ArgumentOutOfRangeException(nameof(length));
            if (halfWidth <= 0f) throw new ArgumentOutOfRangeException(nameof(halfWidth));
            if (radius < 0f || height <= 0f || depth <= 0f)
                throw new ArgumentOutOfRangeException(nameof(radius));
            Id = id;
            Kind = kind;
            Beat = beat;
            Distance = distance;
            Length = length;
            CenterX = centerX;
            HalfWidth = halfWidth;
            Radius = radius;
            Height = height;
            Depth = depth;
            Seed = seed;
        }
    }

    /// <summary>
    /// A sampled safe aperture through terrain. Discrete samples describe a formation
    /// row; continuous samples join into solid banks or canyon walls.
    /// </summary>
    public readonly struct TerrainTraversalSample
    {
        public int Id { get; }
        public TerrainBeatKind Beat { get; }
        public TerrainTraversalMode Mode { get; }
        public float Distance { get; }
        public float CenterX { get; }
        public float HalfWidth { get; }
        public float CollisionHalfDepth { get; }
        public TraversalRequirement Requirement { get; }

        public TerrainTraversalSample(
            int id,
            TerrainBeatKind beat,
            TerrainTraversalMode mode,
            float distance,
            float centerX,
            float halfWidth,
            float collisionHalfDepth = 0f,
            TraversalRequirement requirement = TraversalRequirement.None)
        {
            if (id <= 0) throw new ArgumentOutOfRangeException(nameof(id));
            if (distance < 0f) throw new ArgumentOutOfRangeException(nameof(distance));
            if (halfWidth <= 0f) throw new ArgumentOutOfRangeException(nameof(halfWidth));
            if (mode == TerrainTraversalMode.Discrete && collisionHalfDepth <= 0f)
                throw new ArgumentOutOfRangeException(nameof(collisionHalfDepth));
            Id = id;
            Beat = beat;
            Mode = mode;
            Distance = distance;
            CenterX = centerX;
            HalfWidth = halfWidth;
            CollisionHalfDepth = Math.Max(0f, collisionHalfDepth);
            Requirement = requirement;
        }
    }

    public readonly struct TerrainCourseBeat
    {
        public int Id { get; }
        public TerrainBeatKind Kind { get; }
        public float StartDistance { get; }
        public float Length { get; }
        public float CompletionSpeedReward { get; }
        public float EndDistance => StartDistance + Length;

        public TerrainCourseBeat(
            int id,
            TerrainBeatKind kind,
            float startDistance,
            float length,
            float completionSpeedReward)
        {
            if (id <= 0) throw new ArgumentOutOfRangeException(nameof(id));
            if (startDistance < 0f) throw new ArgumentOutOfRangeException(nameof(startDistance));
            if (length <= 0f) throw new ArgumentOutOfRangeException(nameof(length));
            if (completionSpeedReward < 0f) throw new ArgumentOutOfRangeException(nameof(completionSpeedReward));
            Id = id;
            Kind = kind;
            StartDistance = startDistance;
            Length = length;
            CompletionSpeedReward = completionSpeedReward;
        }
    }

    public sealed class TerrainCoursePlan
    {
        readonly TerrainCourseBeat[] _beats;
        readonly TerrainFormationSpec[] _formations;
        readonly TerrainTraversalSample[] _traversal;

        public string Id { get; }
        public int Sector { get; }
        public float StartDistance { get; }
        public float Length { get; }
        public int BeatCount => _beats.Length;
        public int FormationCount => _formations.Length;
        public int TraversalCount => _traversal.Length;
        public float EndDistance => StartDistance + Length;

        public TerrainCoursePlan(
            string id,
            int sector,
            float startDistance,
            float length,
            TerrainCourseBeat[] beats,
            TerrainFormationSpec[] formations,
            TerrainTraversalSample[] traversal)
        {
            if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("Course id is required.", nameof(id));
            if (sector < 0) throw new ArgumentOutOfRangeException(nameof(sector));
            if (startDistance < 0f || length <= 0f) throw new ArgumentOutOfRangeException(nameof(length));
            if (beats == null || beats.Length < 3) throw new ArgumentException("A terrain course needs multiple beats.", nameof(beats));
            if (formations == null) throw new ArgumentNullException(nameof(formations));
            if (traversal == null || traversal.Length < 4) throw new ArgumentException("A terrain course needs traversal samples.", nameof(traversal));

            _beats = (TerrainCourseBeat[])beats.Clone();
            _formations = (TerrainFormationSpec[])formations.Clone();
            _traversal = (TerrainTraversalSample[])traversal.Clone();
            float priorEnd = 0f;
            for (int i = 0; i < _beats.Length; i++)
            {
                if (i > 0 && _beats[i].StartDistance < priorEnd)
                    throw new ArgumentException("Terrain beats cannot overlap.", nameof(beats));
                if (_beats[i].EndDistance > length + .01f)
                    throw new ArgumentException("Terrain beat extends beyond the course.", nameof(beats));
                priorEnd = _beats[i].EndDistance;
            }
            float priorTraversal = -1f;
            for (int i = 0; i < _traversal.Length; i++)
            {
                if (_traversal[i].Distance <= priorTraversal || _traversal[i].Distance > length)
                    throw new ArgumentException("Traversal samples must be strictly ordered inside the course.", nameof(traversal));
                priorTraversal = _traversal[i].Distance;
            }
            Id = id;
            Sector = sector;
            StartDistance = startDistance;
            Length = length;
        }

        public TerrainCourseBeat GetBeat(int index) => index >= 0 && index < _beats.Length
            ? _beats[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public TerrainFormationSpec GetFormation(int index) => index >= 0 && index < _formations.Length
            ? _formations[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public TerrainTraversalSample GetTraversal(int index) => index >= 0 && index < _traversal.Length
            ? _traversal[index]
            : throw new ArgumentOutOfRangeException(nameof(index));
    }

    public readonly struct TerrainCourseValidation
    {
        public EncounterValidationResult Route { get; }
        public bool BeatCoverageValid { get; }
        public bool FormationCoverageValid { get; }
        public bool IsValid => Route.IsAdmissible && BeatCoverageValid && FormationCoverageValid;

        public TerrainCourseValidation(
            EncounterValidationResult route,
            bool beatCoverageValid,
            bool formationCoverageValid)
        {
            Route = route;
            BeatCoverageValid = beatCoverageValid;
            FormationCoverageValid = formationCoverageValid;
        }
    }

    public sealed class TerrainCourseValidator
    {
        public TerrainCourseValidation Validate(
            TerrainCoursePlan course,
            ShipCapabilityProfile capability,
            int heat)
        {
            if (course == null) throw new ArgumentNullException(nameof(course));
            var openings = new EncounterOpening[course.TraversalCount];
            for (int i = 0; i < openings.Length; i++)
            {
                TerrainTraversalSample sample = course.GetTraversal(i);
                openings[i] = new EncounterOpening(
                    sample.Distance,
                    sample.CenterX,
                    sample.HalfWidth,
                    traversalRequirement: sample.Requirement);
            }
            var contract = new EncounterCapabilityContract(20f, 240f, .35f, .35f, 0, 5);
            var routePlan = new EncounterPlan(
                course.Id + ".route",
                EncounterKind.MonumentalBroadWeave,
                course.Length,
                1f,
                contract,
                openings);
            EncounterValidationResult route = new EncounterCapabilityValidator().Validate(routePlan, capability, heat);

            bool beatsValid = course.GetBeat(0).Kind == TerrainBeatKind.OpenWater
                && course.GetBeat(course.BeatCount - 1).Kind == TerrainBeatKind.ExtractionBreather;
            bool formationsValid = true;
            for (int i = 0; i < course.FormationCount; i++)
            {
                TerrainFormationSpec formation = course.GetFormation(i);
                bool contained = false;
                for (int b = 0; b < course.BeatCount; b++)
                {
                    TerrainCourseBeat beat = course.GetBeat(b);
                    if (formation.Beat == beat.Kind
                        && formation.Distance >= beat.StartDistance
                        && formation.Distance + formation.Length <= beat.EndDistance + .01f)
                    {
                        contained = true;
                        break;
                    }
                }
                if (!contained) { formationsValid = false; break; }
            }
            return new TerrainCourseValidation(route, beatsValid, formationsValid);
        }
    }

    public static class TerrainCourseCatalog
    {
        public static TerrainCoursePlan CreateProofSector(
            int sector,
            float startDistance,
            ShipCapabilityProfile capability)
        {
            int heat = Math.Max(0, Math.Min(5, sector));
            float mirror = (sector & 1) == 0 ? 1f : -1f;
            float widthScale = 1f + heat * .025f;
            var beats = new[]
            {
                new TerrainCourseBeat(1, TerrainBeatKind.OpenWater,             0f, 220f, 0f),
                new TerrainCourseBeat(2, TerrainBeatKind.BoulderSlalom,       220f, 540f, 7f),
                new TerrainCourseBeat(3, TerrainBeatKind.LowBankWeave,        760f, 480f, 6f),
                new TerrainCourseBeat(4, TerrainBeatKind.LightningPassage,   1240f, 380f, 6f),
                new TerrainCourseBeat(5, TerrainBeatKind.NaturalArch,        1620f, 260f, 5f),
                new TerrainCourseBeat(6, TerrainBeatKind.CrystallineCanyon,  1880f,1100f,10f),
                new TerrainCourseBeat(7, TerrainBeatKind.PrismaticCorridor,  2980f, 520f, 7f),
                new TerrainCourseBeat(8, TerrainBeatKind.ExtractionBreather, 3500f, 260f, 0f)
            };

            var formations = new List<TerrainFormationSpec>(12);
            var traversal = new List<TerrainTraversalSample>(48);
            int formationId = 100;
            int traversalId = 1000;

            float[] rowDistance = { 300f, 400f, 505f, 620f, 738f };
            // Alternation is visually strong, but each reversal is constrained by
            // the actual starter ship acceleration and lateral velocity envelope.
            float[] rowCenter = { 12f, -12f, 16f, -17f, 10f };
            float[] rowRadius = { 24f, 29f, 26f, 33f, 28f };
            float[] rowHeight = { 44f, 55f, 49f, 62f, 52f };
            for (int i = 0; i < rowDistance.Length; i++)
            {
                float center = rowCenter[i] * mirror * widthScale;
                float gap = (i == 3 ? 15.5f : 16.5f) + capability.CollisionHalfWidth;
                formations.Add(new TerrainFormationSpec(
                    formationId++,
                    TerrainFormationKind.BoulderGate,
                    TerrainBeatKind.BoulderSlalom,
                    rowDistance[i],
                    0f,
                    center,
                    gap,
                    rowRadius[i],
                    rowHeight[i],
                    rowRadius[i] * 1.7f,
                    101 + sector * 37 + i * 11));
                traversal.Add(new TerrainTraversalSample(
                    traversalId++,
                    TerrainBeatKind.BoulderSlalom,
                    TerrainTraversalMode.Discrete,
                    rowDistance[i],
                    center,
                    gap,
                    rowRadius[i] * .68f));
            }

            formations.Add(new TerrainFormationSpec(
                formationId++,
                TerrainFormationKind.LowBankPair,
                TerrainBeatKind.LowBankWeave,
                780f,
                440f,
                0f,
                20f,
                0f,
                37f,
                74f,
                211 + sector * 41));
            for (int i = 0; i <= 8; i++)
            {
                float t = i / 8f;
                float center = (float)(Math.Sin(t * Math.PI * 2.25) * 14f
                    + Math.Sin(t * Math.PI * 4.1) * 3.5f) * mirror;
                traversal.Add(new TerrainTraversalSample(
                    traversalId++,
                    TerrainBeatKind.LowBankWeave,
                    TerrainTraversalMode.Continuous,
                    780f + t * 440f,
                    center,
                    20f - (float)Math.Sin(t * Math.PI) * 2.5f));
            }

            formations.Add(new TerrainFormationSpec(
                formationId++,
                TerrainFormationKind.BoulderGate,
                TerrainBeatKind.LightningPassage,
                1375f,
                0f,
                -9f * mirror,
                18f,
                23f,
                46f,
                42f,
                307 + sector * 43));
            traversal.Add(new TerrainTraversalSample(
                traversalId++,
                TerrainBeatKind.LightningPassage,
                TerrainTraversalMode.Discrete,
                1375f,
                -9f * mirror,
                18f,
                15f));

            formations.Add(new TerrainFormationSpec(
                formationId++,
                TerrainFormationKind.NaturalArch,
                TerrainBeatKind.NaturalArch,
                1740f,
                80f,
                -11f * mirror,
                9.5f + capability.CollisionHalfWidth * .65f,
                17f,
                63f,
                46f,
                401 + sector * 47));
            traversal.Add(new TerrainTraversalSample(
                traversalId++,
                TerrainBeatKind.NaturalArch,
                TerrainTraversalMode.Discrete,
                1778f,
                -11f * mirror,
                9.5f + capability.CollisionHalfWidth * .65f,
                18f,
                TraversalRequirement.KnifeEdge));

            formations.Add(new TerrainFormationSpec(
                formationId++,
                TerrainFormationKind.CanyonPair,
                TerrainBeatKind.CrystallineCanyon,
                1900f,
                1040f,
                0f,
                21f,
                0f,
                58f,
                88f,
                503 + sector * 53));
            for (int i = 0; i <= 22; i++)
            {
                float t = i / 22f;
                float center = (float)(Math.Sin(t * Math.PI * 2.8) * 20f
                    + Math.Sin(t * Math.PI * 6.1 + .45) * 4f) * mirror;
                float halfWidth = 21f + (float)Math.Sin(t * Math.PI * 3.2 + .7) * 3.2f;
                traversal.Add(new TerrainTraversalSample(
                    traversalId++,
                    TerrainBeatKind.CrystallineCanyon,
                    TerrainTraversalMode.Continuous,
                    1900f + t * 1040f,
                    center,
                    halfWidth));
            }

            formations.Add(new TerrainFormationSpec(
                formationId++,
                TerrainFormationKind.PrismaticCorridor,
                TerrainBeatKind.PrismaticCorridor,
                3005f,
                460f,
                0f,
                18f,
                0f,
                22f,
                1f,
                607 + sector * 59));

            TerrainCoursePlan course = new TerrainCoursePlan(
                $"terrain-sector-{sector:00}",
                sector,
                startDistance,
                3760f,
                beats,
                formations.ToArray(),
                traversal.ToArray());
            TerrainCourseValidation validation = new TerrainCourseValidator().Validate(course, capability, heat);
            if (!validation.IsValid)
                throw new InvalidOperationException(
                    $"Terrain course is not admissible: {course.Id}; "
                    + $"reachable={validation.Route.Reachable}, "
                    + $"neutral={validation.Route.RejectsNeutral}, "
                    + $"left={validation.Route.RejectsConstantLeft}, "
                    + $"right={validation.Route.RejectsConstantRight}, "
                    + $"margin={validation.Route.FeasibilityMargin:0.###}, "
                    + $"beats={validation.BeatCoverageValid}, formations={validation.FormationCoverageValid}");
            return course;
        }
    }
}
