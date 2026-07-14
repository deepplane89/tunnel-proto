using System;
using UnityEngine;
using JetHorizon.Simulation;

namespace JetHorizon
{
    public enum SpawnMode { None, Cones, FatCones, Angled, Lethal, EndlessMix }

    [Serializable]
    public class SequenceStage
    {
        public string name;
        public string type;       // random_cones | fat_cones | angled_walls | structured_walls |
                                  // lethal_rings | slalom_only | zipper_only | l3_cone_corridor |
                                  // corridor | rest | endless_mix
        public string family;     // PRE_T4A_CANYON | PRE_T4B_CANYON | L4_SINE_CORRIDOR | L5_SINE_CORRIDOR
        public float duration;    // 0 = natural end (corridors) or infinite (endless)
        public float speed;       // multiplier of BaseSpeed
        public int physTier;
        public int vibeIdx;
        public string density;    // "ramp" for S1
        public bool darkSlabs;
    }

    [Serializable]
    public class SequenceAsset
    {
        public float baseSpeed;
        public SequenceStage[] stages;

        public static SequenceAsset Load()
        {
            var txt = Resources.Load<TextAsset>("dr_sequence");
            if (txt == null)
            {
                Debug.LogError("[SequenceData] Resources/dr_sequence.json missing");
                return new SequenceAsset { baseSpeed = 36f, stages = Array.Empty<SequenceStage>() };
            }
            return JsonUtility.FromJson<SequenceAsset>(txt.text);
        }

        /// <summary>Maps Unity JSON DTOs into validated engine-neutral campaign content.</summary>
        public RunDefinition ToCoreDefinition()
        {
            if (stages == null || stages.Length == 0)
                throw new InvalidOperationException("The run sequence contains no stages.");

            var definitions = new StageDefinition[stages.Length];
            for (int i = 0; i < stages.Length; i++)
            {
                SequenceStage stage = stages[i] ?? throw new InvalidOperationException($"Stage {i} is null.");
                StageKind kind = stage.type switch
                {
                    "random_cones" => StageKind.RandomCones,
                    "fat_cones" => StageKind.FatCones,
                    "angled_walls" => StageKind.AngledWalls,
                    "structured_walls" => StageKind.StructuredWalls,
                    "lethal_rings" => StageKind.LethalRings,
                    "slalom_only" => StageKind.SlalomOnly,
                    "zipper_only" => StageKind.ZipperOnly,
                    "l3_cone_corridor" => StageKind.Corridor,
                    "corridor" => StageKind.Corridor,
                    "rest" => StageKind.Rest,
                    "endless_mix" => StageKind.EndlessMix,
                    _ => throw new InvalidOperationException($"Unknown stage type '{stage.type}' at index {i}.")
                };
                CorridorFamily family = stage.type == "l3_cone_corridor"
                    ? CorridorFamily.L3Knife
                    : ParseFamily(stage.family, i);
                definitions[i] = new StageDefinition(
                    stage.name,
                    kind,
                    stage.duration,
                    stage.speed,
                    stage.physTier,
                    stage.vibeIdx,
                    family,
                    stage.density == "ramp" ? DensityCurve.Ramp : DensityCurve.Normal,
                    stage.darkSlabs);
            }
            return new RunDefinition(baseSpeed > 0f ? baseSpeed : Tuning.BaseSpeed, definitions);
        }

        static CorridorFamily ParseFamily(string value, int stageIndex)
        {
            return value switch
            {
                null or "" => CorridorFamily.None,
                "PRE_T4A_CANYON" => CorridorFamily.PreT4A,
                "PRE_T4B_CANYON" => CorridorFamily.PreT4B,
                "L3_KNIFE" => CorridorFamily.L3Knife,
                "L4_SINE_CORRIDOR" => CorridorFamily.L4Sine,
                "L5_SINE_CORRIDOR" => CorridorFamily.L5Sine,
                _ => throw new InvalidOperationException($"Unknown corridor family '{value}' at stage {stageIndex}.")
            };
        }
    }
}
