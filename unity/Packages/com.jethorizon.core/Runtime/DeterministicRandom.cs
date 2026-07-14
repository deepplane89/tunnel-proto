namespace JetHorizon.Simulation
{
    /// <summary>Xorshift32 PRNG. The same seed and input frames always produce the same run.</summary>
    public sealed class DeterministicRandom
    {
        uint _state;

        public DeterministicRandom(uint seed)
        {
            Reset(seed);
        }

        public void Reset(uint seed)
        {
            _state = seed == 0u ? 0x6D2B79F5u : seed;
        }

        public uint NextUInt()
        {
            uint x = _state;
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            _state = x;
            return x;
        }

        public float NextFloat()
        {
            return (NextUInt() & 0x00FFFFFFu) / 16777216f;
        }

        public int NextInt(int minimumInclusive, int maximumExclusive)
        {
            if (maximumExclusive <= minimumInclusive) return minimumInclusive;
            uint range = (uint)(maximumExclusive - minimumInclusive);
            return minimumInclusive + (int)(NextUInt() % range);
        }
    }
}
