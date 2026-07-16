using System;

namespace JetHorizon.Simulation
{
    public enum AsteroidSequenceKind
    {
        Random,
        Sweep,
        Stagger,
        Salvo,
        Pinch,
        Chase
    }

    public readonly struct AsteroidImpactRequest
    {
        public float TargetX { get; }
        public float DelaySeconds { get; }
        public AsteroidSequenceKind Sequence { get; }

        internal AsteroidImpactRequest(float targetX, float delaySeconds, AsteroidSequenceKind sequence)
        {
            TargetX = targetX;
            DelaySeconds = delaySeconds;
            Sequence = sequence;
        }
    }

    public sealed class AsteroidImpactRequestBuffer
    {
        readonly AsteroidImpactRequest[] _items;
        public int Count { get; private set; }
        public AsteroidImpactRequest this[int index] => index >= 0 && index < Count
            ? _items[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public AsteroidImpactRequestBuffer(int capacity)
        {
            if (capacity <= 0) throw new ArgumentOutOfRangeException(nameof(capacity));
            _items = new AsteroidImpactRequest[capacity];
        }

        internal void Clear() => Count = 0;
        internal void Add(AsteroidImpactRequest request)
        {
            if (Count >= _items.Length) throw new InvalidOperationException("Asteroid request capacity exceeded.");
            _items[Count++] = request;
        }
    }

    /// <summary>Deterministic port of the source asteroid pattern intentions.</summary>
    public sealed class AsteroidSequenceRuntime
    {
        public void Build(
            AsteroidSequenceKind sequence,
            float shipX,
            float shipVelocityX,
            DeterministicRandom random,
            AsteroidImpactRequestBuffer output)
        {
            if (random == null) throw new ArgumentNullException(nameof(random));
            if (output == null) throw new ArgumentNullException(nameof(output));
            output.Clear();
            switch (sequence)
            {
                case AsteroidSequenceKind.Random:
                    for (int i = 0; i < 4; i++)
                        output.Add(new AsteroidImpactRequest(
                            shipX + (random.NextFloat() - .5f) * 16f,
                            i * .35f,
                            sequence));
                    break;
                case AsteroidSequenceKind.Sweep:
                    float origin = shipX + (random.NextFloat() < .5f ? -8f : 8f);
                    float direction = origin < shipX ? 1f : -1f;
                    for (int i = 0; i < 5; i++)
                        output.Add(new AsteroidImpactRequest(origin + direction * i * 4f, i * .20f, sequence));
                    break;
                case AsteroidSequenceKind.Stagger:
                    float column = shipX;
                    for (int i = 0; i < 5; i++)
                        output.Add(new AsteroidImpactRequest(column, i * .80f, sequence));
                    break;
                case AsteroidSequenceKind.Salvo:
                    for (int i = 0; i < 5; i++)
                        output.Add(new AsteroidImpactRequest(shipX - 14f + i * 7f, 0f, sequence));
                    break;
                case AsteroidSequenceKind.Pinch:
                    for (int pair = 0; pair < 5; pair++)
                    {
                        float half = Math.Max(1.5f, 12f * (1f - pair / 4f));
                        output.Add(new AsteroidImpactRequest(shipX - half, pair * .30f, sequence));
                        output.Add(new AsteroidImpactRequest(shipX + half, pair * .30f, sequence));
                    }
                    output.Add(new AsteroidImpactRequest(shipX, 1.5f, sequence));
                    break;
                case AsteroidSequenceKind.Chase:
                    float predicted = shipX + shipVelocityX * .8f;
                    output.Add(new AsteroidImpactRequest(shipX - (predicted - shipX), 0f, sequence));
                    output.Add(new AsteroidImpactRequest(predicted - 6f, .28f, sequence));
                    output.Add(new AsteroidImpactRequest(predicted + 6f, .56f, sequence));
                    break;
            }
        }
    }
}
