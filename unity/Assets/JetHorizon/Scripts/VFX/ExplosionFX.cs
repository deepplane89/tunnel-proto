using System.Collections;
using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// Death explosion (spec/03 §10): white additive flash sprite scaling up over
    /// 0.15 s + point light + bloom spike to ~1.2 for 0.3 s + debris shards.
    /// Ship hides on death, reappears on retry.
    /// </summary>
    public sealed class ExplosionFX : MonoBehaviour
    {
        public Material FlashMaterial;    // JH/Additive with radial sprite
        public Transform ShipRoot;

        void OnEnable()
        {
            GameEvents.PlayerDied += OnDied;
            GameEvents.RunStarted += OnRunStarted;
        }
        void OnDisable()
        {
            GameEvents.PlayerDied -= OnDied;
            GameEvents.RunStarted -= OnRunStarted;
        }

        void OnRunStarted() { if (ShipRoot != null) ShipRoot.gameObject.SetActive(true); }

        void OnDied()
        {
            var s = GameManager.I.Session;
            Vector3 pos = new Vector3(s.ShipX, s.ShipY, Tuning.ShipZ);
            if (ShipRoot != null) ShipRoot.gameObject.SetActive(false);
            StartCoroutine(Explode(pos));
        }

        IEnumerator Explode(Vector3 pos)
        {
            // flash sprite
            var flash = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(flash.GetComponent<Collider>());
            flash.transform.position = pos;
            var mr = flash.GetComponent<MeshRenderer>();
            mr.sharedMaterial = FlashMaterial;
            var mpb = new MaterialPropertyBlock();
            int tintId = Shader.PropertyToID("_Tint");
            mpb.SetColor(tintId, new Color(1f, 0.93f, 0.87f, 1f));
            mr.SetPropertyBlock(mpb);

            // point light
            var lightGo = new GameObject("expFlashLight");
            lightGo.transform.position = pos + Vector3.up;
            var light = lightGo.AddComponent<Light>();
            light.type = LightType.Point;
            light.color = new Color(1f, 0.93f, 0.87f);
            light.range = 15f;
            light.intensity = 8f;

            // bloom spike
            var volume = FindFirstObjectByType<UnityEngine.Rendering.Volume>();
            UnityEngine.Rendering.Universal.Bloom bloom = null;
            float baseBloom = 0f;
            if (volume != null && volume.profile != null &&
                volume.profile.TryGet(out bloom))
            {
                baseBloom = bloom.intensity.value;
                bloom.intensity.value = 2.4f;   // spike (≈ Unreal 1.2 strength)
            }

            // debris shards
            var cam = UnityEngine.Camera.main;
            const int shardCount = 14;
            var shards = new Transform[shardCount];
            var vels = new Vector3[shardCount];
            for (int i = 0; i < shardCount; i++)
            {
                var sh = GameObject.CreatePrimitive(PrimitiveType.Cube);
                Destroy(sh.GetComponent<Collider>());
                sh.transform.position = pos;
                sh.transform.localScale = Vector3.one * Random.Range(0.08f, 0.28f);
                var smr = sh.GetComponent<MeshRenderer>();
                smr.sharedMaterial = FlashMaterial;
                var shardMpb = new MaterialPropertyBlock();
                shardMpb.SetColor(tintId, new Color(1f, Random.Range(0.4f, 0.8f), 0.15f, 1f));
                smr.SetPropertyBlock(shardMpb);
                shards[i] = sh.transform;
                vels[i] = Random.onUnitSphere * Random.Range(4f, 14f) + Vector3.up * 4f;
            }

            float t = 0f;
            const float dur = 1.2f;
            while (t < dur)
            {
                float rawDt = Mathf.Min(Time.deltaTime, Tuning.MaxRawDt);
                t += rawDt;

                if (flash != null)
                {
                    float ft = Mathf.Clamp01(t / 0.15f);
                    flash.transform.localScale = Vector3.one * Mathf.Lerp(0.1f, 9f, ft);
                    if (cam != null) flash.transform.rotation = cam.transform.rotation;
                    mpb.SetColor(tintId, new Color(1f, 0.93f, 0.87f, 1f - ft));
                    mr.SetPropertyBlock(mpb);
                    if (ft >= 1f) { Destroy(flash); flash = null; }
                }
                light.intensity = Mathf.Max(0f, 8f * (1f - t / 0.4f));
                if (bloom != null && t > 0.3f) bloom.intensity.value = baseBloom;

                for (int i = 0; i < shardCount; i++)
                {
                    if (shards[i] == null) continue;
                    vels[i] += Physics.gravity * rawDt * 0.6f;
                    shards[i].position += vels[i] * rawDt;
                    shards[i].Rotate(vels[i] * 8f * rawDt);
                }
                yield return null;
            }

            if (bloom != null) bloom.intensity.value = baseBloom;
            Destroy(lightGo);
            if (flash != null) Destroy(flash);
            foreach (var sh in shards) if (sh != null) Destroy(sh.gameObject);
        }
    }
}
