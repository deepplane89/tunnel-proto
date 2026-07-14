using System;
using UnityEngine;

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
    }
}
