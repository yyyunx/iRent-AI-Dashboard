import React, { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Html, OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { AlertTriangle, LocateFixed, Rotate3D } from 'lucide-react';
import { Box3, MathUtils, Mesh, PerspectiveCamera, Vector3 } from 'three';

export interface AiViewerPose {
  /** Unit vectors already converted by the backend from Blender Z-up to Three.js Y-up. */
  camera_direction_from_target: [number, number, number];
  camera_up: [number, number, number];
}

export interface Vehicle3DViewerProps {
  aiPose?: AiViewerPose;
  guidanceStatus?: 'idle' | 'checking' | 'full' | 'degraded' | 'unavailable';
  guidanceSummary?: {
    inlierCount: number;
    correspondenceCount: number;
    reprojectionError: number | null;
    yaw?: number;
    pitch?: number;
    distance?: number;
    solverUsed?: 'EPNP' | 'AP3P' | 'NONE';
    degradationReason?: string | null;
  };
  className?: string;
}

interface ViewerErrorBoundaryProps { children: React.ReactNode }
interface ViewerErrorBoundaryState { failed: boolean }

class ViewerErrorBoundary extends Component<ViewerErrorBoundaryProps, ViewerErrorBoundaryState> {
  state: ViewerErrorBoundaryState = { failed: false };
  static getDerivedStateFromError(): ViewerErrorBoundaryState { return { failed: true }; }
  render() {
    if (this.state.failed) {
      return <div className="absolute inset-0 grid place-items-center p-6 text-center bg-gradient-to-b from-white to-[#fff7f7]" role="alert"><div className="max-w-xs flex flex-col items-center gap-2 text-irent-muted"><span className="grid h-11 w-11 place-items-center rounded-full bg-irent-soft-red text-irent-red"><AlertTriangle size={22} /></span><strong className="text-sm text-irent-ink">車輛模型暫時無法載入</strong><span className="text-xs leading-5">仍可繼續拍照檢查，稍後重新整理頁面即可再試。</span></div></div>;
    }
    return this.props.children;
  }
}

const LoadingModel = () => <Html center><div className="whitespace-nowrap rounded-full border border-irent-line bg-white/95 px-3 py-2 text-xs font-bold text-irent-muted shadow-sm">載入 Altis 3D 模型…</div></Html>;

interface ModelFrame {
  center: Vector3;
  corners: Vector3[];
}

const HORIZONTAL_FRAMING_MARGIN = 1.25;
const VERTICAL_FRAMING_MARGIN = 1.1;

const getFitDistance = (camera: PerspectiveCamera, frame: ModelFrame, direction: Vector3, up: Vector3) => {
  const forward = direction.clone().normalize();
  const right = up.clone().cross(forward).normalize();
  if (right.lengthSq() < 1e-8) return null;
  const cameraUp = forward.clone().cross(right).normalize();
  const verticalTan = Math.tan(MathUtils.degToRad(camera.fov) / 2) / camera.zoom;
  const horizontalTan = verticalTan * camera.aspect;
  if (verticalTan <= 0 || horizontalTan <= 0) return null;

  let distance = 0;
  frame.corners.forEach(corner => {
    const offset = corner.clone().sub(frame.center);
    const depth = offset.dot(forward);
    const horizontal = Math.abs(offset.dot(right));
    const vertical = Math.abs(offset.dot(cameraUp));
    distance = Math.max(
      distance,
      depth + (horizontal * HORIZONTAL_FRAMING_MARGIN) / horizontalTan,
      depth + (vertical * VERTICAL_FRAMING_MARGIN) / verticalTan,
    );
  });
  return Number.isFinite(distance) && distance > 0 ? distance : null;
};

const AltisModel: React.FC<{ onFrame: (frame: ModelFrame) => void }> = ({ onFrame }) => {
  const { scene } = useGLTF('/models/altis.glb', '/draco/');
  const model = useMemo(() => scene.clone(true), [scene]);
  useLayoutEffect(() => {
    const points: Vector3[] = [];
    const meshBounds: Array<{ box: Box3; extent: number }> = [];
    model.updateWorldMatrix(true, true);
    model.traverse(object => {
      if (!(object instanceof Mesh) || !object.visible) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (!materials.some(material => material.visible && material.opacity > 0)) return;
      const positions = object.geometry.getAttribute('position');
      if (!positions) return;
      const meshBox = new Box3().setFromObject(object);
      const meshSize = meshBox.getSize(new Vector3());
      const extent = Math.max(meshSize.x, meshSize.y, meshSize.z);
      if (Number.isFinite(extent) && extent > 0) meshBounds.push({ box: meshBox, extent });
      for (let index = 0; index < positions.count; index += 1) {
        const point = new Vector3().fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld);
        if ([point.x, point.y, point.z].every(Number.isFinite)) points.push(point);
      }
    });
    if (!points.length || !meshBounds.length) return;

    // Build a data-derived vehicle envelope from the normal mesh cluster. Vertices
    // belonging to malformed meshes are still retained when they lie on the car.
    meshBounds.sort((a, b) => b.extent - a.extent);
    let sizeSplit = 0;
    let sizeGap = 1;
    const largestAllowedOutlierCluster = Math.max(1, Math.floor(meshBounds.length * 0.2));
    for (let index = 0; index < Math.min(largestAllowedOutlierCluster, meshBounds.length - 1); index += 1) {
      const gap = meshBounds[index].extent / meshBounds[index + 1].extent;
      if (gap > sizeGap) {
        sizeGap = gap;
        sizeSplit = index + 1;
      }
    }
    const normalSizeBounds = sizeGap >= 2.5 ? meshBounds.slice(sizeSplit) : meshBounds;
    const centers = normalSizeBounds.map(entry => entry.box.getCenter(new Vector3()));
    const median = (axis: 'x' | 'y' | 'z') => centers.map(center => center[axis]).sort((a, b) => a - b)[Math.floor(centers.length / 2)];
    const medianCenter = new Vector3(median('x'), median('y'), median('z'));
    const byDistance = normalSizeBounds
      .map(entry => ({ entry, distance: entry.box.getCenter(new Vector3()).distanceTo(medianCenter) }))
      .sort((a, b) => a.distance - b.distance);
    let centerSplit = byDistance.length;
    let centerGap = 1;
    for (let index = Math.max(1, Math.floor(byDistance.length * 0.8)); index < byDistance.length; index += 1) {
      const gap = byDistance[index].distance / Math.max(byDistance[index - 1].distance, 1e-6);
      if (gap > centerGap) {
        centerGap = gap;
        centerSplit = index;
      }
    }
    const normalBounds = centerGap >= 1.5 ? byDistance.slice(0, centerSplit).map(item => item.entry) : normalSizeBounds;
    const envelope = normalBounds.reduce((combined, entry) => combined.union(entry.box), new Box3());
    envelope.expandByVector(envelope.getSize(new Vector3()).multiplyScalar(0.05));
    const renderPoints = points.filter(point => envelope.containsPoint(point));
    const box = new Box3().setFromPoints(renderPoints);
    if (box.isEmpty()) return;
    const sampleStep = Math.max(1, Math.floor(renderPoints.length / 20_000));
    const fitPoints = renderPoints.filter((_, index) => index % sampleStep === 0);
    onFrame({ center: box.getCenter(new Vector3()), corners: fitPoints });
  }, [model, onFrame]);
  return <primitive object={model} />;
};

type OrbitControlsHandle = React.ElementRef<typeof OrbitControls>;

const CameraRig: React.FC<{ frame: ModelFrame | null; pose?: AiViewerPose; revision: number; controls: React.RefObject<OrbitControlsHandle> }> = ({ frame, pose, revision, controls }) => {
  const { camera, size } = useThree();
  const initialized = useRef(false);
  useEffect(() => {
    if (!frame || (!pose && initialized.current)) return;
    const animationFrame = requestAnimationFrame(() => {
      const target = frame.center;
      const direction = pose ? new Vector3(...pose.camera_direction_from_target) : camera.position.clone().sub(target);
      const up = pose ? new Vector3(...pose.camera_up) : camera.up.clone();
      if (direction.lengthSq() < 1e-8 || up.lengthSq() < 1e-8) return;
      direction.normalize();
      up.normalize();
      if (!(camera instanceof PerspectiveCamera)) return;
      const distance = getFitDistance(camera, frame, direction, up);
      if (distance === null) return;
      camera.position.copy(target).addScaledVector(direction, distance);
      camera.up.copy(up);
      if (controls.current) controls.current.target.copy(target);
      camera.lookAt(target);
      controls.current?.update();
      initialized.current = true;
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [camera, controls, frame, pose, revision, size.height, size.width]);
  return null;
};

export const Vehicle3DViewer: React.FC<Vehicle3DViewerProps> = ({ aiPose, guidanceStatus = 'idle', guidanceSummary, className = '' }) => {
  const [aiRevision, setAiRevision] = useState(0);
  const [modelFrame, setModelFrame] = useState<ModelFrame | null>(null);
  const controlsRef = useRef<OrbitControlsHandle>(null);
  const handleModelFrame = useMemo(() => (frame: ModelFrame) => setModelFrame(frame), []);
  const statusText = guidanceStatus === 'checking'
    ? '正在估算 AI 視角…'
    : guidanceStatus === 'full'
      ? 'AI 視角已套用，可自由拖曳'
      : guidanceStatus === 'degraded'
        ? '粗略拍攝方向已套用；此視角不是精確相機重建'
        : guidanceStatus === 'unavailable'
          ? '目前無法可靠估計拍攝位置，照片仍可正常提交。'
          : '上傳車身照片後可取得 AI 視角';

  return (
    <section className={`overflow-hidden rounded-2xl border border-irent-line bg-white shadow-sm ${className}`} aria-labelledby="altis-viewer-title">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-irent-line px-4 py-3">
        <div><h3 id="altis-viewer-title" className="m-0 text-sm font-black text-irent-ink">Altis 3D 拍攝參考</h3><p className="m-0 mt-1 text-xs leading-5 text-irent-muted">{statusText}</p></div>
        <div className="flex items-center gap-2">
          {aiPose && <button type="button" onClick={() => setAiRevision(value => value + 1)} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-irent-red bg-white px-2.5 text-[11px] font-extrabold text-irent-red"><LocateFixed size={13} /> 回到 AI 視角</button>}
          <span className="inline-flex items-center gap-1 rounded-full bg-irent-soft-red px-2.5 py-1 text-[11px] font-extrabold text-irent-red"><Rotate3D size={13} /> 可互動</span>
        </div>
      </header>
      <ViewerErrorBoundary>
        <div className="relative h-[260px] w-full bg-gradient-to-b from-white via-[#fffafa] to-[#f5f6f8] sm:h-[310px]" style={{ touchAction: 'none' }}>
          <Canvas camera={{ position: [6, 4, 8], fov: 38, near: 0.01, far: 2000 }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }} aria-label="可旋轉與縮放的 Toyota Corolla Altis 3D 車輛模型">
            <ambientLight intensity={0.85} /><directionalLight position={[6, 8, 5]} intensity={2.2} /><directionalLight position={[-5, 3, -4]} intensity={0.9} />
            <Suspense fallback={<LoadingModel />}><AltisModel onFrame={handleModelFrame} /></Suspense>
            <OrbitControls ref={controlsRef} makeDefault enablePan={false} enableDamping dampingFactor={0.08} minDistance={0.1} maxDistance={1000} minPolarAngle={Math.PI * 0.15} maxPolarAngle={Math.PI * 0.85} touches={{ ONE: 1, TWO: 2 }} />
            <CameraRig frame={modelFrame} pose={aiPose} revision={aiRevision} controls={controlsRef} />
          </Canvas>
        </div>
      </ViewerErrorBoundary>
      {guidanceSummary && <footer className="flex flex-wrap gap-x-5 gap-y-1 border-t border-irent-line bg-irent-bg/70 px-4 py-2.5 text-xs text-irent-muted">{guidanceStatus === 'degraded' && <span className="font-extrabold text-amber-700">粗略拍攝方向</span>}<span>有效點：<strong className="text-irent-ink">{guidanceSummary.inlierCount}/{guidanceSummary.correspondenceCount}</strong></span>{guidanceSummary.reprojectionError !== null && <span>重投影誤差：<strong className="text-irent-ink">{guidanceSummary.reprojectionError.toFixed(1)} px</strong></span>}{guidanceSummary.yaw !== undefined && <span>方位：<strong className="text-irent-ink">{guidanceSummary.yaw.toFixed(0)}°</strong></span>}{guidanceStatus === 'full' && guidanceSummary.pitch !== undefined && <span>仰角：<strong className="text-irent-ink">{guidanceSummary.pitch.toFixed(0)}°</strong></span>}{guidanceStatus === 'full' && guidanceSummary.distance !== undefined && <span>距離：<strong className="text-irent-ink">{guidanceSummary.distance.toFixed(1)}</strong></span>}</footer>}
    </section>
  );
};

useGLTF.preload('/models/altis.glb', '/draco/');
export default Vehicle3DViewer;
