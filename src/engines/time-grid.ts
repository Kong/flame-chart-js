import { mergeObjects } from '../utils';
import { RenderEngine } from './render-engine';
import { OffscreenRenderEngine } from './offscreen-render-engine';

const MIN_PIXEL_DELTA = 85;

export type TimeGridStyles = {
    color: string;
};

export type TimeGridSettings = {
    styles?: Partial<TimeGridStyles>;
};

export const defaultTimeGridStyles: TimeGridStyles = {
    color: 'rgba(90,90,90,0.20)',
};

export class TimeGrid {
    renderEngine: OffscreenRenderEngine | RenderEngine;
    start: number;
    end: number;
    accuracy: number;
    delta: number;
    styles: TimeGridStyles = defaultTimeGridStyles;
    timeUnits = 'ms';

    timeWidth: number;
    proportion: number;

    constructor(settings: TimeGridSettings) {
        this.start = 0;
        this.end = 0;
        this.accuracy = 0;
        this.delta = 0;

        this.setSettings(settings);
    }

    setDefaultRenderEngine(renderEngine: OffscreenRenderEngine | RenderEngine) {
        this.renderEngine = renderEngine;
        this.timeUnits = this.renderEngine.getTimeUnits();
    }

    setSettings({ styles }: TimeGridSettings) {
        this.styles = mergeObjects(defaultTimeGridStyles, styles);

        if (this.renderEngine) {
            this.timeUnits = this.renderEngine.getTimeUnits();
        }
    }

    recalc() {
        this.timeWidth = this.renderEngine.max - this.renderEngine.min;
        const initialLinesCount = this.renderEngine.width / MIN_PIXEL_DELTA;
        const initialTimeLineDelta = this.timeWidth / initialLinesCount;

        const realView = this.renderEngine.getRealView();

        this.proportion = realView / (this.timeWidth || 1);

        this.delta = initialTimeLineDelta / Math.pow(2, Math.floor(Math.log2(1 / this.proportion)));
        this.start = Math.floor((this.renderEngine.positionX - this.renderEngine.min) / this.delta);
        this.end = Math.ceil(realView / this.delta) + this.start;

        this.accuracy = this.calcNumberFix();
    }

    calcNumberFix() {
        const strTimelineDelta = (this.delta / 2).toString();

        if (strTimelineDelta.includes('e')) {
            return Number(strTimelineDelta.match(/\d+$/)?.[0]);
        }

        const zeros = strTimelineDelta.match(/(0\.0*)/);

        return zeros ? zeros[0].length - 1 : 0;
    }

    getTimelineAccuracy() {
        return this.accuracy;
    }

    forEachTime(cb: (pixelPosition: number, timePosition: number) => void) {
        if (Number.isFinite(this.start) && Number.isFinite(this.end)) {
            for (let i = this.start; i <= this.end; i++) {
                const timePosition = i * this.delta + this.renderEngine.min;
                const pixelPosition = this.renderEngine.timeToPosition(Number(timePosition.toFixed(this.accuracy)));

                cb(pixelPosition, timePosition);
            }
        }
    }

    renderLines(start: number, height: number, renderEngine: OffscreenRenderEngine | RenderEngine = this.renderEngine) {
        renderEngine.setCtxValue('fillStyle', this.styles.color);

        this.forEachTime((pixelPosition: number) => {
            renderEngine.fillRect(pixelPosition, start, 1, height);
        });
    }

    renderTimes(renderEngine: OffscreenRenderEngine | RenderEngine = this.renderEngine) {
        renderEngine.setCtxValue('fillStyle', renderEngine.styles.fontColor);
        renderEngine.setCtxFont(renderEngine.styles.font);

        if (!this.renderEngine.options.nonSequential) {
            this.forEachTime((pixelPosition, timePosition) => {
                renderEngine.fillText(
                    timePosition.toFixed(this.accuracy) + this.timeUnits,
                    pixelPosition + renderEngine.blockPaddingLeftRight,
                    renderEngine.charHeight,
                );
            });
        } else {
            renderEngine.setCtxValue('textAlign', 'center');
            renderEngine.fillText(
                (this.timeWidth * this.proportion).toFixed(this.accuracy) + this.timeUnits,
                renderEngine.blockPaddingLeftRight + renderEngine.width / 2,
                renderEngine.charHeight,
            );
        }
    }
}
