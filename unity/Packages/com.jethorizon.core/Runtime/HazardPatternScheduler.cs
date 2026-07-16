using System;

namespace JetHorizon.Simulation
{
    public enum ScheduledHazardFamily
    {
        None,
        Lightning,
        Asteroid
    }

    public readonly struct ScheduledHazardPatternRequest
    {
        public ScheduledHazardFamily Family { get; }
        public LightningSequenceKind Lightning { get; }
        public AsteroidSequenceKind Asteroid { get; }
        public float SafeCenterX { get; }
        public float SafeHalfWidth { get; }

        internal ScheduledHazardPatternRequest(
            ScheduledHazardFamily family,
            LightningSequenceKind lightning,
            AsteroidSequenceKind asteroid,
            float safeCenterX,
            float safeHalfWidth)
        {
            Family = family;
            Lightning = lightning;
            Asteroid = asteroid;
            SafeCenterX = safeCenterX;
            SafeHalfWidth = safeHalfWidth;
        }
    }

    public sealed class ScheduledHazardPatternRequestBuffer
    {
        readonly ScheduledHazardPatternRequest[] _items;
        public int Count { get; private set; }
        public ScheduledHazardPatternRequest this[int index] => index >= 0 && index < Count
            ? _items[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public ScheduledHazardPatternRequestBuffer(int capacity)
        {
            if (capacity <= 0) throw new ArgumentOutOfRangeException(nameof(capacity));
            _items = new ScheduledHazardPatternRequest[capacity];
        }

        internal void Clear() => Count = 0;
        internal void Add(ScheduledHazardPatternRequest request)
        {
            if (Count >= _items.Length) throw new InvalidOperationException("Scheduled hazard request capacity exceeded.");
            _items[Count++] = request;
        }
    }

    /// <summary>
    /// Owns one coordinated hazard window at a time. No other family can inject into
    /// that window unless a future mixed blueprint explicitly schedules it here.
    /// </summary>
    public sealed class HazardPatternScheduler
    {
        ScheduledHazardFamily _family;
        LightningSequenceKind _lightning;
        AsteroidSequenceKind _asteroid;
        int _remaining;
        float _interval;
        float _timer;
        float _safeCenterX;
        float _safeHalfWidth;

        public ScheduledHazardFamily ActiveFamily => _family;

        public void Reset()
        {
            _family = ScheduledHazardFamily.None;
            _remaining = 0;
            _timer = 0f;
        }

        public void BeginLightning(
            LightningSequenceKind sequence,
            int heat,
            float safeCenterX,
            float safeHalfWidth)
        {
            _family = ScheduledHazardFamily.Lightning;
            _lightning = sequence;
            _remaining = sequence == LightningSequenceKind.Random ? 4 + Math.Min(3, heat) : 2;
            _interval = LightningInterval(heat);
            _timer = 0f;
            _safeCenterX = safeCenterX;
            _safeHalfWidth = safeHalfWidth;
        }

        public void BeginAsteroid(
            AsteroidSequenceKind sequence,
            int heat,
            float safeCenterX,
            float safeHalfWidth)
        {
            _family = ScheduledHazardFamily.Asteroid;
            _asteroid = sequence;
            _remaining = sequence == AsteroidSequenceKind.Chase ? 3 : heat >= 4 ? 2 : 1;
            _interval = sequence == AsteroidSequenceKind.Chase
                ? Math.Max(1.2f, 4f - heat * .55f)
                : 1.8f;
            _timer = 0f;
            _safeCenterX = safeCenterX;
            _safeHalfWidth = safeHalfWidth;
        }

        public void Tick(float dt, ScheduledHazardPatternRequestBuffer output)
        {
            if (output == null) throw new ArgumentNullException(nameof(output));
            output.Clear();
            if (_family == ScheduledHazardFamily.None || _remaining <= 0) return;
            _timer -= Math.Max(0f, dt);
            if (_timer > 0f) return;

            output.Add(new ScheduledHazardPatternRequest(
                _family,
                _lightning,
                _asteroid,
                _safeCenterX,
                _safeHalfWidth));
            _remaining--;
            _timer = _interval;
            if (_remaining <= 0) _family = ScheduledHazardFamily.None;
        }

        public static float LightningInterval(int heat)
        {
            switch (Math.Max(0, Math.Min(5, heat)))
            {
                case 0: return .80f;
                case 1: return .62f;
                case 2: return .50f;
                default: return .36f;
            }
        }
    }
}
