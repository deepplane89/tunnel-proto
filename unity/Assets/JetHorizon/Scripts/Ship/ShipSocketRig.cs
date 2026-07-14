using JetHorizon.Simulation;
using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// Unity adapter for engine-neutral ship attachment points. Sockets are children
    /// of the imported model so exhaust stays attached during ship motion or animation.
    /// </summary>
    public sealed class ShipSocketRig : MonoBehaviour
    {
        public Transform MainThrusterLeft { get; private set; }
        public Transform MainThrusterRight { get; private set; }
        public Transform MiniThrusterLeft { get; private set; }
        public Transform MiniThrusterRight { get; private set; }
        public bool MiniThrustersEnabled { get; private set; }

        public void Configure(ShipDefinition definition, Transform model)
        {
            if (definition == null || model == null) return;
            ClearSockets();
            model.localPosition = ToVector3(definition.ModelPosition);
            model.localRotation = Quaternion.Euler(
                definition.ModelRotationRadians.X * Mathf.Rad2Deg,
                definition.ModelRotationRadians.Y * Mathf.Rad2Deg,
                definition.ModelRotationRadians.Z * Mathf.Rad2Deg);
            model.localScale = Vector3.one * definition.ModelScale;
            var sockets = definition.Thrusters;
            MainThrusterLeft = CreateSocket("Socket_Thruster_Main_L", sockets.MainLeft, model);
            MainThrusterRight = CreateSocket("Socket_Thruster_Main_R", sockets.MainRight, model);
            MiniThrusterLeft = CreateSocket("Socket_Thruster_Mini_L", sockets.MiniLeft, model);
            MiniThrusterRight = CreateSocket("Socket_Thruster_Mini_R", sockets.MiniRight, model);
            MiniThrustersEnabled = sockets.MiniThrustersEnabled;
        }

        Transform CreateSocket(string socketName, Float3 position, Transform model)
        {
            var socket = new GameObject(socketName).transform;
            socket.SetParent(model, false);
            Vector3 rootLocal = new Vector3(position.X, position.Y, position.Z);
            socket.position = transform.TransformPoint(rootLocal);
            socket.rotation = transform.rotation;
            return socket;
        }

        static Vector3 ToVector3(Float3 value) => new Vector3(value.X, value.Y, value.Z);

        void ClearSockets()
        {
            DestroySocket(MainThrusterLeft);
            DestroySocket(MainThrusterRight);
            DestroySocket(MiniThrusterLeft);
            DestroySocket(MiniThrusterRight);
            MainThrusterLeft = MainThrusterRight = MiniThrusterLeft = MiniThrusterRight = null;
        }

        static void DestroySocket(Transform socket)
        {
            if (socket == null) return;
            if (UnityEngine.Application.isPlaying) Destroy(socket.gameObject);
            else DestroyImmediate(socket.gameObject);
        }
    }
}
