import { useEffect, useRef, useState } from "react";

const VIEWPORT = 300; // размер квадратной области кропа в px
const OUTPUT = 512; // сторона итогового квадрата
const JPEG_QUALITY = 0.85;

type AvatarCropModalProps = {
  file: File;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
};

// Кроп аватара: пан мышью/пальцем + зум ползунком, вывод — квадратный JPEG.
// Любой формат (в т.ч. HEIC с iPhone, который декодируется браузером) пережимается
// canvas'ом в маленький JPEG — уходит проблема формата и размера (413).
export function AvatarCropModal({ file, busy, onCancel, onConfirm }: AvatarCropModalProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const [, forceRender] = useState(0);
  const baseScaleRef = useRef(1);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const reader = new FileReader();
    reader.onload = () => {
      if (cancelled || typeof reader.result !== "string") return;
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        baseScaleRef.current = VIEWPORT / Math.min(img.naturalWidth, img.naturalHeight);
        offsetRef.current = {
          x: (VIEWPORT - img.naturalWidth * baseScaleRef.current) / 2,
          y: (VIEWPORT - img.naturalHeight * baseScaleRef.current) / 2
        };
        imgRef.current = img;
        setImage(img);
        setZoom(1);
      };
      img.onerror = () => {
        if (!cancelled) setError("Не удалось открыть изображение. Попробуйте JPG или PNG.");
      };
      img.src = reader.result;
    };
    reader.onerror = () => {
      if (!cancelled) setError("Не удалось прочитать файл.");
    };
    reader.readAsDataURL(file);
    return () => {
      cancelled = true;
    };
  }, [file]);

  function scale() {
    return baseScaleRef.current * zoom;
  }

  function clampOffset(x: number, y: number, s: number, img: HTMLImageElement) {
    const dw = img.naturalWidth * s;
    const dh = img.naturalHeight * s;
    return {
      x: Math.min(0, Math.max(VIEWPORT - dw, x)),
      y: Math.min(0, Math.max(VIEWPORT - dh, y))
    };
  }

  function handlePointerDown(event: React.PointerEvent) {
    if (!image) return;
    dragRef.current = { x: event.clientX - offsetRef.current.x, y: event.clientY - offsetRef.current.y };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent) {
    if (!dragRef.current || !image) return;
    const next = clampOffset(event.clientX - dragRef.current.x, event.clientY - dragRef.current.y, scale(), image);
    offsetRef.current = next;
    forceRender((n) => n + 1);
  }

  function handlePointerUp() {
    dragRef.current = null;
  }

  function handleZoom(nextZoom: number) {
    if (!image) return;
    const s0 = scale();
    const s1 = baseScaleRef.current * nextZoom;
    // зум вокруг центра вьюпорта
    const cx = VIEWPORT / 2;
    const cy = VIEWPORT / 2;
    const imgX = (cx - offsetRef.current.x) / s0;
    const imgY = (cy - offsetRef.current.y) / s0;
    const nx = cx - imgX * s1;
    const ny = cy - imgY * s1;
    offsetRef.current = clampOffset(nx, ny, s1, image);
    setZoom(nextZoom);
  }

  function handleConfirm() {
    const img = imgRef.current;
    if (!img) return;
    const s = scale();
    const sourceSize = VIEWPORT / s;
    const sx = -offsetRef.current.x / s;
    const sy = -offsetRef.current.y / s;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, sourceSize, sourceSize, 0, 0, OUTPUT, OUTPUT);
    onConfirm(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
  }

  const s = scale();

  return (
    <div className="avatar-crop-backdrop" role="dialog" aria-modal="true" aria-label="Обрезка фото">
      <div className="avatar-crop-card">
        <h3>Обрезка фото</h3>
        {error ? (
          <div className="error-box">{error}</div>
        ) : (
          <>
            <div
              className="avatar-crop-viewport"
              style={{ width: VIEWPORT, height: VIEWPORT }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              {image ? (
                <img
                  className="avatar-crop-image"
                  src={image.src}
                  alt=""
                  draggable={false}
                  style={{
                    width: image.naturalWidth * s,
                    height: image.naturalHeight * s,
                    transform: `translate(${offsetRef.current.x}px, ${offsetRef.current.y}px)`
                  }}
                />
              ) : (
                <div className="muted avatar-crop-loading">Загрузка…</div>
              )}
              <div className="avatar-crop-ring" aria-hidden="true" />
            </div>
            <label className="avatar-crop-zoom">
              Масштаб
              <input
                type="range"
                min={1}
                max={4}
                step={0.01}
                value={zoom}
                onChange={(event) => handleZoom(Number(event.target.value))}
              />
            </label>
          </>
        )}
        <div className="avatar-crop-actions">
          <button type="button" className="ghost-button" disabled={busy} onClick={onCancel}>
            Отмена
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={busy || !image || Boolean(error)}
            onClick={handleConfirm}
          >
            {busy ? "Загрузка…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}
