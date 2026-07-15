using System;

namespace JetHorizon.Simulation
{
    public enum LightningSequenceKind
    {
        Random,
        Sweep,
        Stagger,
        Salvo,
        Pinch
    }

    public readonly struct LightningStrikeRequest
    {
        public float TargetX { get; }
        public LightningSequenceKind Sequence { get; }

        internal LightningStrikeRequest(float targetX, LightningSequenceKind sequence)
        {
            TargetX = targetX;
            Sequence = sequence;
        }
    }

    public sealed class LightningStrikeRequestBuffer
    {
        readonly LightningStrikeRequest[] _items;

        public int Count { get; private set; }
        public LightningStrikeRequest this[int index] => index >= 0 && index < Count
            ? _items[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public LightningStrikeRequestBuffer(int capacity)
        {
            if (capacity <= 0) throw new ArgumentOutOfRangeException(nameof(capacity));
            _items = new LightningStrikeRequest[capacity];
        }

        internal void Clear() => Count = 0;

        internal void Add(LightningStrikeRequest request)
        {
            if (Count >= _items.Length)
                throw new InvalidOperationException("Lightning strike request capacity exceeded.");
            _items[Count++] = request;
        }
    }

    /// <summary>
    /// Engine-neutral port of the Three.js L-panel lightning choreography.
    /// It schedules target intentions only; hazard lifetime, collision, and Unity
    /// presentation remain owned by their existing layers.
    /// </summary>
    public sealed class LightningSequenceRuntime
    {
        const float LaneMinimum = -8f;
        const float LaneMaximum = 8f;
        const float SweepSpeed = .4f;
        const int SalvoCount = 3;
        const int PinchPairs = 5;
        const float PinchSpread = 1f;
        const int Capacity = 64;

        struct PendingStrike
        {
            public bool Active;
            public float Delay;
            public bool TrackLiveShip;
            public float AnchorX;
            public float OffsetX;
            public LightningSequenceKind Sequence;
        }

        readonly PendingStrike[] _pending = new PendingStrike[Capacity];
        float _sweepX = .5f;
        int _sweepDirection = 1;

        public int PendingCount
        {
            get
            {
                int count = 0;
                for (int i = 0; i < _pending.Length; i++)
                    if (_pending[i].Active) count++;
                return count;
            }
        }

        public void Reset()
        {
            Array.Clear(_pending, 0, _pending.Length);
            _sweepX = .5f;
            _sweepDirection = 1;
        }

        public void Begin(LightningSequenceKind sequence, float shipX, DeterministicRandom random)
        {
            if (random == null) throw new ArgumentNullException(nameof(random));
            float range = LaneMaximum - LaneMinimum;
            switch (sequence)
            {
                case LightningSequenceKind.Random:
                    Schedule(0f, true, shipX, (random.NextFloat() - .5f) * 3f, sequence);
                    break;

                case LightningSequenceKind.Sweep:
                    float sweepOffset = (_sweepX - .5f) * range;
                    _sweepX += _sweepDirection * SweepSpeed * .35f;
                    if (_sweepX >= 1f || _sweepX <= 0f)
                    {
                        _sweepDirection *= -1;
                        _sweepX = Math.Max(0f, Math.Min(1f, _sweepX));
                    }
                    for (int i = 0; i < SalvoCount; i++)
                    {
                        float spread = (i / (float)(SalvoCount - 1) - .5f) * range * .5f;
                        Schedule(i * .25f, true, shipX, sweepOffset + spread, sequence);
                    }
                    break;

                case LightningSequenceKind.Stagger:
                    Schedule(0f, true, shipX, 0f, sequence);
                    break;

                case LightningSequenceKind.Salvo:
                    float half = range * .45f;
                    for (int i = 0; i < SalvoCount; i++)
                    {
                        float offset = (i / (float)(SalvoCount - 1) - .5f) * half * 2f;
                        Schedule(0f, false, shipX, offset, sequence);
                    }
                    break;

                case LightningSequenceKind.Pinch:
                    float fullHalf = range * .5f * PinchSpread;
                    for (int pair = 0; pair < PinchPairs; pair++)
                    {
                        float halfSpread = Math.Max(.3f, fullHalf * (1f - pair / (float)(PinchPairs - 1)));
                        float delay = pair * .3f;
                        Schedule(delay, false, shipX, -halfSpread, sequence);
                        Schedule(delay, false, shipX, halfSpread, sequence);
                    }
                    Schedule(PinchPairs * .3f, false, shipX, 0f, sequence);
                    break;
            }
        }

        public void Tick(float dt, float liveShipX, LightningStrikeRequestBuffer requests)
        {
            if (float.IsNaN(dt) || float.IsInfinity(dt) || dt < 0f)
                throw new ArgumentOutOfRangeException(nameof(dt));
            if (requests == null) throw new ArgumentNullException(nameof(requests));
            requests.Clear();
            for (int i = 0; i < _pending.Length; i++)
            {
                PendingStrike strike = _pending[i];
                if (!strike.Active) continue;
                strike.Delay -= dt;
                if (strike.Delay > 0f)
                {
                    _pending[i] = strike;
                    continue;
                }

                float anchor = strike.TrackLiveShip ? liveShipX : strike.AnchorX;
                requests.Add(new LightningStrikeRequest(anchor + strike.OffsetX, strike.Sequence));
                _pending[i] = default;
            }
        }

        void Schedule(
            float delay,
            bool trackLiveShip,
            float anchorX,
            float offsetX,
            LightningSequenceKind sequence)
        {
            for (int i = 0; i < _pending.Length; i++)
            {
                if (_pending[i].Active) continue;
                _pending[i] = new PendingStrike
                {
                    Active = true,
                    Delay = Math.Max(0f, delay),
                    TrackLiveShip = trackLiveShip,
                    AnchorX = anchorX,
                    OffsetX = offsetX,
                    Sequence = sequence
                };
                return;
            }
            throw new InvalidOperationException("Lightning sequence queue capacity exceeded.");
        }
    }
}
