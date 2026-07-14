using System.Collections.Generic;
using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// Canyon slab corridors (spec/02 §6): two recycled pools of crystalline slabs,
    /// stateless per-Z corridor functions, entrance choreography (fly in from −500,
    /// reveal at −210), 0.4 s entry speed ramp, 4 s drift-out exit.
    /// Each activation gets a FRESH CanyonPreset — no shared mutable tuner.
    /// </summary>
    public sealed class CanyonSystem : MonoBehaviour, ISimSystem
    {
        public LightningSystem Lightning;
        public PickupSystem Pickups;

        sealed class Slab
        {
            public Transform T;
            public MeshRenderer R;
            public int Side;           // -1 left, +1 right
            public bool IsEntrance;
            public float BakedX;
            public float InnerX;
        }

        const float EntranceSpawnZ = -500f;
        const float RevealZ = -210f;
        const float SafeZ = -150f;

        CanyonPreset _p;
        float _stageSpeedMult;
        readonly List<Slab> _slabs = new List<Slab>(40);
        GameObject _root;
        float _elapsed;
        bool _revealed;
        float _sinePhase;
        float _l4RowsElapsed;
        float _rampT;
        float _savedSpeed;
        float _snapTime;

        static Material _cyanMat, _darkMat;

        RunSession S => GameManager.I.Session;

        public void ResetSystem() => DestroyWalls(clearFlags: true);

        // ── Activation ───────────────────────────────────────────────────────
        public void Activate(CanyonPreset preset, float stageSpeedMult)
        {
            DestroyWalls(clearFlags: true);
            _p = preset;
            _stageSpeedMult = stageSpeedMult;
            _elapsed = 0f; _revealed = false; _rampT = 0f;
            _sinePhase = 0f; _l4RowsElapsed = 0f; _snapTime = 0f;

            var s = S;
            _savedSpeed = s.Speed;
            s.CorridorGapCenter = s.ShipX;
            s.CanyonActive = true; s.CanyonExiting = false;
            Pickups.WipeBonusRings();

            EnsureMaterials();
            BuildWalls();

        }

        void EnsureMaterials()
        {
            if (_cyanMat != null) return;
            var shader = Shader.Find("Universal Render Pipeline/Lit");
            _cyanMat = new Material(shader) { name = "JH_CanyonCyan" };
            _cyanMat.SetColor("_BaseColor", TextureFactory.Hex(0x04d4f0));
            _cyanMat.SetFloat("_Smoothness", 0.6f);
            _cyanMat.SetFloat("_Metallic", 0f);
            _cyanMat.SetFloat("_ClearCoatMask", 0.65f);
            _cyanMat.SetFloat("_ClearCoatSmoothness", 0.78f);
            _cyanMat.SetFloat("_Cull", 0f);
            _cyanMat.EnableKeyword("_CLEARCOAT");
            _cyanMat.EnableKeyword("_EMISSION");
            // Keep the source neon edge language, but let the sun and ship remain
            // the exposure anchors. The prior 1.1 multiplier made whole facets read
            // self-lit instead of catching light from the scene.
            _cyanMat.SetColor("_EmissionColor", TextureFactory.Hex(0x6ef2ff) * 0.72f);
            _cyanMat.SetTexture("_EmissionMap", TextureFactory.CyanSlab());
            _cyanMat.globalIlluminationFlags = MaterialGlobalIlluminationFlags.None;

            _darkMat = new Material(shader) { name = "JH_CanyonDark" };
            // Preserve the near-black crystal language without letting untextured
            // facets collapse to invisible black under the gameplay camera.
            _darkMat.SetColor("_BaseColor", TextureFactory.Hex(0x141425));
            _darkMat.SetFloat("_Smoothness", 0.78f);
            _darkMat.SetFloat("_Metallic", 0f);
            _darkMat.SetFloat("_ClearCoatMask", 0.40f);
            _darkMat.SetFloat("_ClearCoatSmoothness", 0.92f);
            _darkMat.SetFloat("_Cull", 0f);
            _darkMat.EnableKeyword("_CLEARCOAT");
            _darkMat.EnableKeyword("_EMISSION");
            _darkMat.SetColor("_EmissionColor", TextureFactory.Hex(0xff00cc) * 0.68f);
            _darkMat.SetTexture("_EmissionMap", TextureFactory.DarkSlab());
            _darkMat.globalIlluminationFlags = MaterialGlobalIlluminationFlags.None;
        }

        void BuildWalls()
        {
            var s = S;
            _root = new GameObject("Canyon");
            _root.transform.SetParent(transform, false);

            float spacing = _p.SlabW;
            int poolPerSide = Mathf.CeilToInt((Tuning.DespawnZ - _p.SpawnDepth) / spacing) + 3;

            // sine phase pre-seeded so sin == 0 when the ship meets the first regular slab
            float firstRegularZ = SafeZ - spacing;
            _sinePhase = -(Mathf.Round((Tuning.ShipZ - firstRegularZ) / spacing) * (2f * Mathf.PI / _p.SinePeriod) * _p.SineSpeed);

            for (int side = -1; side <= 1; side += 2)
            {
                // Entrance slab: thick, long, flies in from −500; X frozen at its final resting Z
                var ent = MakeSlab(side, isEntrance: true);
                float entHalfX = HalfXAtZ(SafeZ);
                ent.InnerX = CenterAtZInit(SafeZ) + entHalfX * side;
                ent.BakedX = ent.InnerX - _p.FootX * side;
                ent.T.position = new Vector3(ent.BakedX, 0f, EntranceSpawnZ);
                AssignMaterial(ent, SafeZ);

                float z = firstRegularZ;
                for (int i = 0; i < poolPerSide; i++)
                {
                    var slab = MakeSlab(side, isEntrance: false);
                    float halfX = HalfXAtZ(z);
                    slab.InnerX = CenterAtZInit(z) + halfX * side;
                    slab.BakedX = slab.InnerX - _p.FootX * side;
                    slab.T.position = new Vector3(slab.BakedX, 0f, z);
                    AssignMaterial(slab, z);
                    slab.T.gameObject.SetActive(false);          // frozen + invisible until reveal
                    z -= spacing;
                }
            }
        }

        readonly List<Mesh> _ownedMeshes = new List<Mesh>(40);

        Slab MakeSlab(int side, bool isEntrance)
        {
            var go = new GameObject(isEntrance ? "entrance" : "slab");
            go.layer = 8;   // reflectable — mirrors in the water plane
            go.transform.SetParent(_root.transform, false);
            var mf = go.AddComponent<MeshFilter>();
            float thick = isEntrance ? _p.EntranceThick : _p.SlabThick;
            float w = isEntrance ? 200f : _p.SlabW;
            mf.sharedMesh = MeshFactory.CanyonSlab(
                _p.SlabH, w, thick, _p.Cols, _p.Rows, _p.Disp, CurrentSnap(),
                _p.FootX, _p.SweepX, _p.MidX, _p.CrestX, Random.Range(1, 99999));
            _ownedMeshes.Add(mf.sharedMesh);
            var mr = go.AddComponent<MeshRenderer>();
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            // Inner face at local x=0, body extends +X. Right wall (+1): inner face (−X normal)
            // already looks at the corridor. Left wall (−1): rotate 180° about Y (NOT negative
            // scale — that flips winding and breaks backface culling).
            go.transform.rotation = Quaternion.Euler(0f, side < 0 ? 180f : 0f, 0f);
            var slab = new Slab { T = go.transform, R = mr, Side = side, IsEntrance = isEntrance };
            _slabs.Add(slab);
            return slab;
        }

        float CurrentSnap()
        {
            if (!_p.SnapOscillates) return _p.Snap;
            return 0.1f + 1.4f * (0.5f + 0.5f * Mathf.Sin(_snapTime * 2f * Mathf.PI / 4f));
        }

        void AssignMaterial(Slab slab, float z)
        {
            bool cyan = _p.AllCyan || (!_p.AllDark && Mathf.RoundToInt(-z / _p.SlabW) % 2 == 0);
            slab.R.sharedMaterial = cyan ? _cyanMat : _darkMat;
        }

        // ── Stateless corridor functions (spec/02 §6.4) ─────────────────────
        float IntensityAtZ(float z)
        {
            if (_p.Mode == 5)
            {
                float t = Mathf.Clamp01((z - SafeZ) / (-500f - SafeZ));
                return _p.SineStartI + (_p.SineIntensity - _p.SineStartI) * t;
            }
            return _p.SineIntensity;
        }

        float HalfXAtZ(float z)
        {
            if (_p.L4Recreation) return _p.HalfXOverride;
            if (_p.Mode != 5) return _p.HalfXOverride;
            float t = Mathf.Clamp01((z - SafeZ) / (-500f - SafeZ));
            return Mathf.Max(5f, _p.HalfXStart + (_p.HalfXFull - _p.HalfXStart) * t);
        }

        float XSineAtZ(float z)
        {
            float phase = ((z - SafeZ) / _p.SinePeriod) * 2f * Mathf.PI * _p.SineSpeed;
            return _p.SineAmp * IntensityAtZ(z) * Mathf.Sin(phase);
        }

        float CenterAtZInit(float z)
        {
            if (_p.L4Recreation) return L4SineAtZ(z);
            return S.CorridorGapCenter + XSineAtZ(z);
        }

        float PredictCenter(int rowsAhead)
        {
            if (_p.L4Recreation)
                return L4SineAtZ(Tuning.ShipZ - rowsAhead * _p.SlabW);
            float phase = _sinePhase + rowsAhead * (2f * Mathf.PI / _p.SinePeriod) * _p.SineSpeed;
            float approxZ = Tuning.ShipZ - rowsAhead * _p.SlabW;
            return S.CorridorGapCenter + _p.SineAmp * IntensityAtZ(approxZ) * Mathf.Sin(phase);
        }

        /// <summary>L3-knife mode: centerline follows the L4 corridor sine (spec/02 §6.4).</summary>
        float L4SineAtZ(float z)
        {
            const float RampCompress = 1.45f;
            float rawRows = Mathf.Max(0f, (SafeZ - z) / 7f);
            float rows = rawRows * RampCompress + _l4RowsElapsed;
            float curveRows = Mathf.Max(0f, rows - 45f);   // CLOSE 35 + STRAIGHT 10
            if (curveRows <= 0f) return S.CorridorGapCenter;
            float ampT = Mathf.Min(1f, curveRows / 120f);
            float amp = 14f + (44f - 14f) * ampT * ampT;
            float perT = Mathf.Min(1f, curveRows / 260f);
            float period = 220f - (220f - 160f) * perT * perT;
            return S.CorridorGapCenter + amp * Mathf.Sin(curveRows * 2f * Mathf.PI / period);
        }

        // ── Per-frame update ────────────────────────────────────────────────
        public void SimTick(float dt)
        {
            var s = S;
            if (!s.CanyonActive && !s.CanyonExiting) return;

            _elapsed += dt;
            _snapTime += dt;
            float spacing = _p.SlabW;
            float scroll = Mathf.Max(s.Speed, Tuning.BaseSpeed) * dt * _p.ScrollSpeed;

            if (_revealed)
            {
                if (_p.SineIntensity > 0f)
                    _sinePhase += (scroll / _p.SinePeriod) * 2f * Mathf.PI * _p.SineSpeed;
                if (_p.L4Recreation)
                    _l4RowsElapsed += (scroll / 7f) * 1.45f;
            }

            // entry speed ramp after reveal: saved → BASE * max(stageSpeed, floor), 0.4 s ease-out
            if (_revealed && s.CanyonActive && _rampT < 1f)
            {
                _rampT = Mathf.Min(1f, _rampT + dt / _p.EntryRamp);
                float e = 1f - Mathf.Pow(1f - _rampT, 3f);
                float target = Tuning.BaseSpeed * Mathf.Max(_stageSpeedMult, s.SpeedFloor);
                s.Speed = Mathf.Lerp(_savedSpeed, target, e);
                if (_rampT >= 1f) GameEvents.RaiseSpeedChanged(_savedSpeed, s.Speed);
            }

            // exit choreography
            if (s.CanyonActive && _elapsed >= _p.Duration - _p.ExitWindow)
            {
                s.CanyonActive = false;
                s.CanyonExiting = true;
            }

            bool anyVisible = false;
            foreach (var slab in _slabs)
            {
                bool scrollingYet = slab.IsEntrance || _revealed;
                if (!scrollingYet) continue;

                var p = slab.T.position;
                p.z += scroll;
                p.x = slab.BakedX;                     // never re-evaluated laterally
                slab.T.position = p;

                if (slab.IsEntrance && !_revealed && p.z >= RevealZ)
                    Reveal();

                if (p.z > Tuning.DespawnZ + spacing)
                {
                    if (s.CanyonExiting || slab.IsEntrance)
                    {
                        slab.T.gameObject.SetActive(false);
                        continue;
                    }
                    RecycleSlab(slab, spacing);
                }
                if (slab.T.gameObject.activeSelf) anyVisible = true;
            }

            if (s.CanyonExiting && (!anyVisible || _elapsed >= _p.Duration + 8f))
            {
                DestroyWalls(clearFlags: true);
                return;
            }

        }

        void Reveal()
        {
            _revealed = true;
            foreach (var slab in _slabs)
                if (!slab.IsEntrance) slab.T.gameObject.SetActive(true);
            GameEvents.RaiseCanyonRevealed();
        }

        void RecycleSlab(Slab slab, float spacing)
        {
            // find min Z among other non-entrance slabs on this side
            float minZ = float.MaxValue;
            foreach (var other in _slabs)
                if (other != slab && !other.IsEntrance && other.Side == slab.Side)
                    minZ = Mathf.Min(minZ, other.T.position.z);

            float snappedMin = Mathf.Round(minZ / spacing) * spacing;
            float z = snappedMin - spacing;
            int rowsAhead = Mathf.Max(0, Mathf.RoundToInt((Tuning.ShipZ - z) / spacing));
            float center = PredictCenter(rowsAhead);
            float halfX = HalfXAtZ(z);
            slab.InnerX = center + halfX * slab.Side;
            // The mesh's visible foot is authored at local X=FootX, not at its pivot.
            // Compensate the pivot exactly as the production canyon does so HalfX means
            // the visible corridor boundary rather than an extra-wide hidden offset.
            slab.BakedX = slab.InnerX - _p.FootX * slab.Side;

            float nextCenter = PredictCenter(rowsAhead + 1);
            float yaw = slab.Side * Mathf.Atan2(nextCenter - center, spacing) * Mathf.Rad2Deg;
            float baseYaw = slab.Side < 0 ? 180f : 0f;
            slab.T.rotation = Quaternion.Euler(0f, baseYaw + yaw, 0f);
            slab.T.position = new Vector3(slab.BakedX, 0f, z);
            AssignMaterial(slab, z);
        }

        /// <summary>
        /// Supplies the current visual corridor's inner faces as plain values. The
        /// engine-neutral simulation decides whether those bounds kill the ship.
        /// </summary>
        public bool TryGetCollisionBounds(out float leftBoundary, out float rightBoundary)
        {
            leftBoundary = float.NegativeInfinity;
            rightBoundary = float.PositiveInfinity;
            if (!S.CanyonActive || !_revealed) return false;

            float spacing = _p.SlabW;
            bool hasLeft = false;
            bool hasRight = false;
            foreach (var slab in _slabs)
            {
                if (slab.IsEntrance || !slab.T.gameObject.activeSelf) continue;
                float z = slab.T.position.z;
                if (z < Tuning.ShipZ - spacing || z > Tuning.ShipZ + spacing) continue;

                if (slab.Side > 0)
                {
                    rightBoundary = Mathf.Min(rightBoundary, slab.InnerX);
                    hasRight = true;
                }
                else
                {
                    leftBoundary = Mathf.Max(leftBoundary, slab.InnerX);
                    hasLeft = true;
                }
            }
            return hasLeft && hasRight;
        }

        void DestroyWalls(bool clearFlags)
        {
            _slabs.Clear();
            if (_root != null) Destroy(_root);
            _root = null;
            foreach (var m in _ownedMeshes) if (m != null) Destroy(m);   // procedural meshes leak otherwise
            _ownedMeshes.Clear();
            if (clearFlags && GameManager.I != null)
            {
                S.CanyonActive = false;
                S.CanyonExiting = false;
            }
        }
    }
}
