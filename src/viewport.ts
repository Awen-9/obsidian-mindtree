export interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 3;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Pan and zoom for the map stage. Wheel pans, Ctrl/Cmd+wheel (or pinch) zooms. */
export class Viewport {
	x = 0;
	y = 0;
	k = 1;
	/** True once the view was panned or zoomed since the last fit. */
	moved = false;
	private lastW = 0;
	private lastH = 0;

	constructor(
		private host: HTMLElement,
		private stage: HTMLElement,
	) {
		host.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
		host.addEventListener("pointerdown", (e) => this.onPointerDown(e));
	}

	private apply(): void {
		this.stage.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.k})`;
	}

	private onWheel(e: WheelEvent): void {
		e.preventDefault();
		if (e.ctrlKey || e.metaKey) {
			const rect = this.host.getBoundingClientRect();
			this.zoomAt(Math.exp(-clamp(e.deltaY, -40, 40) * 0.01), e.clientX - rect.left, e.clientY - rect.top);
		} else {
			this.x -= e.deltaX;
			this.y -= e.deltaY;
			this.moved = true;
			this.apply();
		}
	}

	private onPointerDown(e: PointerEvent): void {
		if (e.button !== 0 || (e.target as HTMLElement).closest(".mt-node, .mt-toggle")) return;
		const startX = e.clientX - this.x;
		const startY = e.clientY - this.y;
		const move = (ev: PointerEvent) => {
			this.x = ev.clientX - startX;
			this.y = ev.clientY - startY;
			this.moved = true;
			this.apply();
		};
		const up = () => {
			this.host.removeEventListener("pointermove", move);
			this.host.removeEventListener("pointerup", up);
			this.host.removeEventListener("pointercancel", up);
			this.host.classList.remove("is-panning");
		};
		this.host.setPointerCapture(e.pointerId);
		this.host.classList.add("is-panning");
		this.host.addEventListener("pointermove", move);
		this.host.addEventListener("pointerup", up);
		this.host.addEventListener("pointercancel", up);
	}

	zoomAt(factor: number, cx: number, cy: number): void {
		const k = clamp(this.k * factor, MIN_SCALE, MAX_SCALE);
		const ratio = k / this.k;
		this.x = cx - (cx - this.x) * ratio;
		this.y = cy - (cy - this.y) * ratio;
		this.k = k;
		this.moved = true;
		this.apply();
	}

	zoomCenter(factor: number): void {
		this.zoomAt(factor, this.host.clientWidth / 2, this.host.clientHeight / 2);
	}

	toStage(clientX: number, clientY: number): { x: number; y: number } {
		const rect = this.host.getBoundingClientRect();
		return { x: (clientX - rect.left - this.x) / this.k, y: (clientY - rect.top - this.y) / this.k };
	}

	fit(b: Bounds): void {
		const W = this.host.clientWidth;
		const H = this.host.clientHeight;
		if (!W || !H) return;
		const pad = 40;
		const bw = b.maxX - b.minX;
		const bh = b.maxY - b.minY;
		this.k = clamp(Math.min(1, (W - 2 * pad) / bw, (H - 2 * pad) / bh), MIN_SCALE, 1);
		this.x = W / 2 - ((b.minX + b.maxX) / 2) * this.k;
		this.y = H / 2 - ((b.minY + b.maxY) / 2) * this.k;
		this.moved = false;
		this.lastW = W;
		this.lastH = H;
		this.apply();
	}

	/** After the host was resized without a refit: keep the same map point at the centre. */
	keepCenter(): void {
		const W = this.host.clientWidth;
		const H = this.host.clientHeight;
		if (this.lastW) {
			this.x += (W - this.lastW) / 2;
			this.y += (H - this.lastH) / 2;
			this.apply();
		}
		this.lastW = W;
		this.lastH = H;
	}

	/** Pan so a stage-space rect sits at the centre of the host. */
	center(r: { x: number; y: number; w: number; h: number }): void {
		this.x = this.host.clientWidth / 2 - (r.x + r.w / 2) * this.k;
		this.y = this.host.clientHeight / 2 - (r.y + r.h / 2) * this.k;
		this.moved = true;
		this.apply();
	}

	/** Pan the minimum distance needed to bring a stage-space rect into view. */
	reveal(r: { x: number; y: number; w: number; h: number }): void {
		const m = 24;
		const W = this.host.clientWidth;
		const H = this.host.clientHeight;
		const left = r.x * this.k + this.x;
		const right = (r.x + r.w) * this.k + this.x;
		const top = r.y * this.k + this.y;
		const bottom = (r.y + r.h) * this.k + this.y;
		const x0 = this.x;
		const y0 = this.y;
		if (left < m) this.x += m - left;
		else if (right > W - m) this.x -= right - (W - m);
		if (top < m) this.y += m - top;
		else if (bottom > H - m) this.y -= bottom - (H - m);
		if (this.x !== x0 || this.y !== y0) this.moved = true;
		this.apply();
	}

	restore(): void {
		this.apply();
	}
}
