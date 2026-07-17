using System;
using System.Collections.Generic;

namespace JetHorizon.Simulation
{
    public enum CargoWaveRouteRole
    {
        Safe,
        Valuable,
        Hero
    }

    public enum CargoCollectibleFamily
    {
        Salvage,
        PowerCell,
        Prism,
        CreditCache,
        Powerup
    }

    /// <summary>
    /// Core-owned lifecycle of a finite piece of the run. FullyBuilt means host
    /// engines may construct the complete presentation, but it is still outside
    /// the reveal distance. PassingBehind deliberately outlives Active.
    /// </summary>
    public enum CargoWaveLifecycle
    {
        None,
        Queued,
        FullyBuilt,
        HorizonReveal,
        Approach,
        Active,
        PassingBehind,
        Recovery,
        Rest,
        Complete
    }

    public readonly struct CargoWaveRoutePoint
    {
        public CargoWaveRouteRole Role { get; }
        public float Distance { get; }
        public float CenterX { get; }
        public float HalfWidth { get; }

        public CargoWaveRoutePoint(
            CargoWaveRouteRole role,
            float distance,
            float centerX,
            float halfWidth)
        {
            if (distance < 0f) throw new ArgumentOutOfRangeException(nameof(distance));
            if (halfWidth <= 0f) throw new ArgumentOutOfRangeException(nameof(halfWidth));
            Role = role;
            Distance = distance;
            CenterX = centerX;
            HalfWidth = halfWidth;
        }
    }

    public readonly struct CargoWaveCollectible
    {
        public int Id { get; }
        public CargoCollectibleFamily Family { get; }
        public CargoWaveRouteRole RouteRole { get; }
        public RunCargoKind CargoKind { get; }
        public PowerupType Powerup { get; }
        public int Units { get; }
        public float Distance { get; }
        public float X { get; }
        public float Y { get; }

        public CargoWaveCollectible(
            int id,
            CargoCollectibleFamily family,
            CargoWaveRouteRole routeRole,
            RunCargoKind cargoKind,
            PowerupType powerup,
            int units,
            float distance,
            float x,
            float y)
        {
            if (id <= 0) throw new ArgumentOutOfRangeException(nameof(id));
            if (distance < 0f) throw new ArgumentOutOfRangeException(nameof(distance));
            if (units <= 0) throw new ArgumentOutOfRangeException(nameof(units));
            if (family == CargoCollectibleFamily.Powerup && powerup == PowerupType.None)
                throw new ArgumentOutOfRangeException(nameof(powerup));
            Id = id;
            Family = family;
            RouteRole = routeRole;
            CargoKind = cargoKind;
            Powerup = powerup;
            Units = units;
            Distance = distance;
            X = x;
            Y = y;
        }
    }

    /// <summary>
    /// Immutable, engine-neutral cargo-first gameplay parcel. Terrain topology
    /// remains in TerrainWorldPlan; this plan declares how the player reads and
    /// exploits one finite section of that world.
    /// </summary>
    public sealed class CargoWavePlan
    {
        readonly CargoWaveRoutePoint[] _routePoints;
        readonly CargoWaveCollectible[] _collectibles;

        public string Id { get; }
        public TerrainWaveKind Kind { get; }
        public float StartDistance { get; }
        public float Length { get; }
        public float EndDistance => StartDistance + Length;
        public float HorizonRevealDistance { get; }
        public float ApproachDistance { get; }
        public float RearCullDistance { get; }
        public float RecoveryDistance { get; }
        public bool IsBreather => Kind == TerrainWaveKind.OpenWaterReset
            || Kind == TerrainWaveKind.ReleaseBasin
            || Kind == TerrainWaveKind.OpenWaterBreather;
        public int RoutePointCount => _routePoints.Length;
        public int CollectibleCount => _collectibles.Length;

        public CargoWavePlan(
            string id,
            TerrainWaveKind kind,
            float startDistance,
            float length,
            float horizonRevealDistance,
            float approachDistance,
            float rearCullDistance,
            float recoveryDistance,
            CargoWaveRoutePoint[] routePoints,
            CargoWaveCollectible[] collectibles)
        {
            if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("Wave id is required.", nameof(id));
            if (startDistance < 0f || length <= 0f) throw new ArgumentOutOfRangeException(nameof(length));
            if (horizonRevealDistance <= approachDistance || approachDistance <= 0f)
                throw new ArgumentOutOfRangeException(nameof(horizonRevealDistance));
            if (rearCullDistance <= 0f || recoveryDistance < 0f)
                throw new ArgumentOutOfRangeException(nameof(rearCullDistance));
            if (routePoints == null || routePoints.Length < 3)
                throw new ArgumentException("A cargo wave needs an authored route.", nameof(routePoints));
            if (collectibles == null) throw new ArgumentNullException(nameof(collectibles));

            _routePoints = (CargoWaveRoutePoint[])routePoints.Clone();
            _collectibles = (CargoWaveCollectible[])collectibles.Clone();
            for (int i = 0; i < _routePoints.Length; i++)
                if (_routePoints[i].Distance < startDistance || _routePoints[i].Distance > startDistance + length)
                    throw new ArgumentException("Route point lies outside its wave.", nameof(routePoints));
            for (int i = 0; i < _collectibles.Length; i++)
                if (_collectibles[i].Distance < startDistance || _collectibles[i].Distance > startDistance + length)
                    throw new ArgumentException("Collectible lies outside its wave.", nameof(collectibles));

            Id = id;
            Kind = kind;
            StartDistance = startDistance;
            Length = length;
            HorizonRevealDistance = horizonRevealDistance;
            ApproachDistance = approachDistance;
            RearCullDistance = rearCullDistance;
            RecoveryDistance = recoveryDistance;
        }

        public CargoWaveRoutePoint GetRoutePoint(int index) => index >= 0 && index < _routePoints.Length
            ? _routePoints[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public CargoWaveCollectible GetCollectible(int index) => index >= 0 && index < _collectibles.Length
            ? _collectibles[index]
            : throw new ArgumentOutOfRangeException(nameof(index));
    }

    public sealed class CargoWaveSequencePlan
    {
        readonly CargoWavePlan[] _waves;

        public string WorldId { get; }
        public float WorldStartDistance { get; }
        public float WorldEndDistance { get; }
        public int WaveCount => _waves.Length;

        public CargoWaveSequencePlan(
            string worldId,
            float worldStartDistance,
            float worldEndDistance,
            CargoWavePlan[] waves)
        {
            if (string.IsNullOrWhiteSpace(worldId)) throw new ArgumentException("World id is required.", nameof(worldId));
            if (worldStartDistance < 0f || worldEndDistance <= worldStartDistance)
                throw new ArgumentOutOfRangeException(nameof(worldEndDistance));
            if (waves == null || waves.Length == 0) throw new ArgumentException("Sequence needs waves.", nameof(waves));
            _waves = (CargoWavePlan[])waves.Clone();
            float previousStart = -1f;
            for (int i = 0; i < _waves.Length; i++)
            {
                CargoWavePlan wave = _waves[i];
                if (wave.StartDistance < worldStartDistance || wave.EndDistance > worldEndDistance + .01f)
                    throw new ArgumentException("Wave lies outside its terrain world.", nameof(waves));
                if (wave.StartDistance <= previousStart)
                    throw new ArgumentException("Waves must be ordered.", nameof(waves));
                previousStart = wave.StartDistance;
            }
            WorldId = worldId;
            WorldStartDistance = worldStartDistance;
            WorldEndDistance = worldEndDistance;
        }

        public CargoWavePlan GetWave(int index) => index >= 0 && index < _waves.Length
            ? _waves[index]
            : throw new ArgumentOutOfRangeException(nameof(index));
    }

    public readonly struct CargoWaveValidation
    {
        public bool Ordered { get; }
        public bool RoutesInsideWorld { get; }
        public bool CollectiblesOnRoutes { get; }
        public bool HasSafeAndValuableRoutes { get; }
        public bool IsValid => Ordered && RoutesInsideWorld && CollectiblesOnRoutes && HasSafeAndValuableRoutes;

        public CargoWaveValidation(
            bool ordered,
            bool routesInsideWorld,
            bool collectiblesOnRoutes,
            bool hasSafeAndValuableRoutes)
        {
            Ordered = ordered;
            RoutesInsideWorld = routesInsideWorld;
            CollectiblesOnRoutes = collectiblesOnRoutes;
            HasSafeAndValuableRoutes = hasSafeAndValuableRoutes;
        }
    }

    public sealed class CargoWaveValidator
    {
        public CargoWaveValidation Validate(
            CargoWaveSequencePlan sequence,
            TerrainWorldPlan world,
            ShipCapabilityProfile capability)
        {
            if (sequence == null) throw new ArgumentNullException(nameof(sequence));
            if (world == null) throw new ArgumentNullException(nameof(world));

            bool ordered = true;
            bool inside = true;
            bool collectibleRoutes = true;
            bool routeRoles = true;
            float priorStart = -1f;
            for (int waveIndex = 0; waveIndex < sequence.WaveCount; waveIndex++)
            {
                CargoWavePlan wave = sequence.GetWave(waveIndex);
                ordered &= wave.StartDistance > priorStart;
                priorStart = wave.StartDistance;
                bool hasSafe = false;
                bool hasValuable = false;
                for (int pointIndex = 0; pointIndex < wave.RoutePointCount; pointIndex++)
                {
                    CargoWaveRoutePoint point = wave.GetRoutePoint(pointIndex);
                    hasSafe |= point.Role == CargoWaveRouteRole.Safe;
                    hasValuable |= point.Role == CargoWaveRouteRole.Valuable;
                    inside &= IsNavigable(world, capability, point.Role, point.Distance, point.CenterX, point.HalfWidth);
                }
                routeRoles &= hasSafe && (hasValuable || wave.IsBreather);
                for (int collectibleIndex = 0; collectibleIndex < wave.CollectibleCount; collectibleIndex++)
                {
                    CargoWaveCollectible collectible = wave.GetCollectible(collectibleIndex);
                    bool matched = false;
                    for (int pointIndex = 0; pointIndex < wave.RoutePointCount; pointIndex++)
                    {
                        CargoWaveRoutePoint point = wave.GetRoutePoint(pointIndex);
                        if (point.Role != collectible.RouteRole) continue;
                        float longitudinal = Math.Abs(point.Distance - collectible.Distance);
                        float lateral = Math.Abs(point.CenterX - collectible.X);
                        if (longitudinal <= Math.Max(25f, wave.Length * .18f)
                            && lateral <= point.HalfWidth)
                        {
                            matched = true;
                            break;
                        }
                    }
                    collectibleRoutes &= matched;
                }
            }
            return new CargoWaveValidation(ordered, inside, collectibleRoutes, routeRoles);
        }

        static bool IsNavigable(
            TerrainWorldPlan world,
            ShipCapabilityProfile capability,
            CargoWaveRouteRole role,
            float absoluteDistance,
            float centerX,
            float routeHalfWidth)
        {
            float localDistance = absoluteDistance - world.StartDistance;
            TerrainRouteKind routeKind = role == CargoWaveRouteRole.Safe
                ? TerrainRouteKind.SafeCanyon
                : role == CargoWaveRouteRole.Valuable
                    ? TerrainRouteKind.CargoChannel
                    : TerrainRouteKind.KnifeEdgeTunnel;
            if (world.TryGetRoutePassage(routeKind, localDistance, out float left, out float right, out _))
                return centerX - routeHalfWidth - capability.CollisionHalfWidth >= left - .01f
                    && centerX + routeHalfWidth + capability.CollisionHalfWidth <= right + .01f;

            if (!world.TrySampleWater(localDistance, out left, out right)) return false;
            return centerX - routeHalfWidth - capability.CollisionHalfWidth >= left - .01f
                && centerX + routeHalfWidth + capability.CollisionHalfWidth <= right + .01f;
        }
    }

    /// <summary>
    /// Adapts the existing persistent terrain topology into the first cargo-first
    /// wave library. This is deterministic content authoring, not runtime spawning.
    /// </summary>
    public static class CargoFirstWaveCatalog
    {
        public static CargoWaveSequencePlan Create(
            TerrainWorldPlan world,
            ShipCapabilityProfile capability)
        {
            if (world == null) throw new ArgumentNullException(nameof(world));
            if (world.ParcelCount > 0)
            {
                var parcelWaves = new CargoWavePlan[world.ParcelCount];
                for (int i = 0; i < parcelWaves.Length; i++)
                    parcelWaves[i] = world.GetParcel(i).Cargo
                        ?? throw new InvalidOperationException("Every parcel must publish its cargo contract.");
                return new CargoWaveSequencePlan(
                    world.Id,
                    world.StartDistance,
                    world.EndDistance,
                    parcelWaves);
            }
            var waves = new CargoWavePlan[world.WaveCount];
            int collectibleId = world.Sector * 10000 + 1;
            for (int i = 0; i < world.WaveCount; i++)
            {
                TerrainWorldWave source = world.GetWave(i);
                float start = world.StartDistance + source.StartDistance;
                float end = start + source.Length;
                float nextStart = i + 1 < world.WaveCount
                    ? world.StartDistance + world.GetWave(i + 1).StartDistance
                    : world.EndDistance;
                float recovery = Math.Max(0f, nextStart - end);
                float reveal = Math.Max(240f, capability.CruiseSpeed * 2.2f);
                float approach = Math.Max(110f, capability.CruiseSpeed * .85f);
                if (i > 0)
                {
                    TerrainWorldWave priorWave = world.GetWave(i - 1);
                    bool followsBreather = priorWave.Kind == TerrainWaveKind.OpenWaterReset
                        || priorWave.Kind == TerrainWaveKind.ReleaseBasin;
                    if (followsBreather)
                    {
                        // The prior finite wave must clear before the next landmark
                        // begins revealing. Use the latter part of the authored
                        // water reset instead of leaking reward glints through the
                        // preceding terrain beat.
                        reveal = Math.Min(reveal, Math.Max(140f, priorWave.Length * .65f));
                        approach = Math.Min(approach, reveal * .62f);
                    }
                }
                var routePoints = new List<CargoWaveRoutePoint>(8);
                var collectibles = new List<CargoWaveCollectible>(8);

                AddRoute(CargoWaveRouteRole.Safe, new[] { .24f, .50f, .76f });
                bool breather = source.Kind == TerrainWaveKind.OpenWaterReset
                    || source.Kind == TerrainWaveKind.ReleaseBasin;
                if (!breather)
                {
                    AddRoute(CargoWaveRouteRole.Valuable, new[] { .34f, .66f });
                    if (source.Kind == TerrainWaveKind.L3KnifeSineTunnel
                        || source.Kind == TerrainWaveKind.PortalChoice)
                        AddRoute(CargoWaveRouteRole.Hero, new[] { .52f });
                }

                for (int pointIndex = 0; pointIndex < routePoints.Count; pointIndex++)
                {
                    CargoWaveRoutePoint point = routePoints[pointIndex];
                    if (breather) continue;
                    if (point.Role == CargoWaveRouteRole.Safe)
                    {
                        collectibles.Add(new CargoWaveCollectible(
                            collectibleId++, CargoCollectibleFamily.Salvage,
                            point.Role, RunCargoKind.Salvage, PowerupType.None,
                            1, point.Distance, point.CenterX, 1.25f));
                    }
                    else if (point.Role == CargoWaveRouteRole.Valuable)
                    {
                        // Power cells settle through the existing Alloy ledger until
                        // the persistent economy gains a dedicated resource column.
                        collectibles.Add(new CargoWaveCollectible(
                            collectibleId++, CargoCollectibleFamily.PowerCell,
                            point.Role, RunCargoKind.Alloy, PowerupType.None,
                            1, point.Distance, point.CenterX, 1.40f));
                    }
                    else
                    {
                        collectibles.Add(new CargoWaveCollectible(
                            collectibleId++, CargoCollectibleFamily.Prism,
                            point.Role, RunCargoKind.Prism, PowerupType.None,
                            1, point.Distance, point.CenterX, 1.55f));
                    }
                }

                waves[i] = new CargoWavePlan(
                    world.Id + ".cargo-wave-" + i.ToString("00"),
                    source.Kind,
                    start,
                    source.Length,
                    reveal,
                    approach,
                    Math.Max(80f, capability.CruiseSpeed * .65f),
                    recovery,
                    routePoints.ToArray(),
                    collectibles.ToArray());

                void AddRoute(CargoWaveRouteRole role, float[] fractions)
                {
                    for (int fractionIndex = 0; fractionIndex < fractions.Length; fractionIndex++)
                    {
                        float distance = start + source.Length * fractions[fractionIndex];
                        ResolveRoute(world, source.Kind, role, distance, out float center, out float halfWidth);
                        routePoints.Add(new CargoWaveRoutePoint(role, distance, center, halfWidth));
                    }
                }
            }

            var sequence = new CargoWaveSequencePlan(
                world.Id,
                world.StartDistance,
                world.EndDistance,
                waves);
            CargoWaveValidation validation = new CargoWaveValidator().Validate(sequence, world, capability);
            if (!validation.IsValid)
                throw new InvalidOperationException("Cargo-first wave sequence is not admissible: " + world.Id);
            return sequence;
        }

        static void ResolveRoute(
            TerrainWorldPlan world,
            TerrainWaveKind waveKind,
            CargoWaveRouteRole role,
            float absoluteDistance,
            out float center,
            out float halfWidth)
        {
            float localDistance = absoluteDistance - world.StartDistance;
            TerrainRouteKind requested = role == CargoWaveRouteRole.Safe
                ? TerrainRouteKind.SafeCanyon
                : role == CargoWaveRouteRole.Valuable
                    ? TerrainRouteKind.CargoChannel
                    : TerrainRouteKind.KnifeEdgeTunnel;
            if (world.TryGetRoutePassage(requested, localDistance, out float left, out float right, out _))
            {
                center = (left + right) * .5f;
                halfWidth = Math.Max(2.5f, Math.Min(6f, (right - left) * .5f - 2.5f));
                return;
            }

            if (!world.TrySampleWater(localDistance, out left, out right))
                throw new InvalidOperationException("Wave route lies outside the terrain world.");
            float waterCenter = (left + right) * .5f;
            float waterHalf = (right - left) * .5f;
            float sign = (((int)waveKind + world.Sector) & 1) == 0 ? 1f : -1f;
            if (role == CargoWaveRouteRole.Safe) center = waterCenter;
            else if (role == CargoWaveRouteRole.Valuable)
                center = waterCenter + sign * Math.Min(18f, waterHalf * .28f);
            else
                center = waterCenter - sign * Math.Min(24f, waterHalf * .36f);
            halfWidth = Math.Max(3f, Math.Min(7f, waterHalf - Math.Abs(center - waterCenter) - 3f));
        }
    }

    public readonly struct CargoWaveRuntimeState
    {
        public string WaveId { get; }
        public TerrainWaveKind Kind { get; }
        public CargoWaveLifecycle Lifecycle { get; }
        public float StartDistance { get; }
        public float EndDistance { get; }
        public float Progress01 { get; }
        public bool IsRest => Lifecycle == CargoWaveLifecycle.Rest;

        internal CargoWaveRuntimeState(
            CargoWavePlan wave,
            CargoWaveLifecycle lifecycle,
            float progress01)
        {
            WaveId = wave?.Id ?? string.Empty;
            Kind = wave?.Kind ?? default;
            Lifecycle = lifecycle;
            StartDistance = wave?.StartDistance ?? 0f;
            EndDistance = wave?.EndDistance ?? 0f;
            Progress01 = progress01;
        }
    }

    /// <summary>
    /// Tracks finite-wave lifecycle and complete queued plans. It never creates
    /// Unity objects and never advances run distance.
    /// </summary>
    public sealed class CargoWaveRuntime
    {
        readonly ShipCapabilityProfile _capability;
        CargoWaveSequencePlan _current;
        CargoWaveSequencePlan _queued;
        CargoWaveRuntimeState _state;

        public CargoWaveSequencePlan Current => _current;
        public CargoWaveSequencePlan Queued => _queued;
        public CargoWaveRuntimeState Snapshot => _state;

        public CargoWaveRuntime(ShipCapabilityProfile capability)
        {
            _capability = capability;
        }

        public void Reset(TerrainWorldPlan current)
        {
            _current = current == null ? null : CargoFirstWaveCatalog.Create(current, _capability);
            _queued = null;
            _state = _current == null
                ? default
                : Resolve(_current, current.StartDistance);
        }

        public void Sync(TerrainWorldPlan current, TerrainWorldPlan queued, float runDistance)
        {
            if (current == null)
            {
                _current = null;
                _queued = null;
                _state = default;
                return;
            }
            if (_current == null || _current.WorldId != current.Id)
            {
                if (_queued != null && _queued.WorldId == current.Id)
                {
                    _current = _queued;
                    _queued = null;
                }
                else _current = CargoFirstWaveCatalog.Create(current, _capability);
            }
            if (queued == null) _queued = null;
            else if (_queued == null || _queued.WorldId != queued.Id)
                _queued = CargoFirstWaveCatalog.Create(queued, _capability);
            _state = Resolve(_current, runDistance);
        }

        static CargoWaveRuntimeState Resolve(CargoWaveSequencePlan sequence, float runDistance)
        {
            if (sequence == null) return default;
            CargoWavePlan prior = null;
            for (int i = 0; i < sequence.WaveCount; i++)
            {
                CargoWavePlan wave = sequence.GetWave(i);
                if (runDistance < wave.StartDistance - wave.HorizonRevealDistance)
                    return new CargoWaveRuntimeState(wave, CargoWaveLifecycle.FullyBuilt, 0f);
                if (runDistance < wave.StartDistance - wave.ApproachDistance)
                    return new CargoWaveRuntimeState(wave, CargoWaveLifecycle.HorizonReveal, 0f);
                if (runDistance < wave.StartDistance)
                    return new CargoWaveRuntimeState(wave, CargoWaveLifecycle.Approach, 0f);
                if (runDistance <= wave.EndDistance)
                {
                    float progress = Math.Max(0f, Math.Min(1f,
                        (runDistance - wave.StartDistance) / wave.Length));
                    return new CargoWaveRuntimeState(
                        wave,
                        wave.IsBreather ? CargoWaveLifecycle.Rest : CargoWaveLifecycle.Active,
                        progress);
                }
                if (runDistance <= wave.EndDistance + wave.RearCullDistance)
                    prior = wave;
                if (i + 1 < sequence.WaveCount
                    && runDistance < sequence.GetWave(i + 1).StartDistance)
                    return new CargoWaveRuntimeState(
                        prior ?? wave,
                        prior != null ? CargoWaveLifecycle.PassingBehind : CargoWaveLifecycle.Recovery,
                        1f);
            }
            CargoWavePlan last = sequence.GetWave(sequence.WaveCount - 1);
            if (runDistance < sequence.WorldEndDistance)
                return new CargoWaveRuntimeState(last, CargoWaveLifecycle.Rest, 1f);
            return new CargoWaveRuntimeState(last, CargoWaveLifecycle.Complete, 1f);
        }
    }
}
