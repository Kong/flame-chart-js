import Color from 'color';
import { OffscreenRenderEngine } from '../engines/offscreen-render-engine';
import { SeparatedInteractionsEngine } from '../engines/separated-interactions-engine';
import {
    ClusterizedFlatTree,
    ClusterizedFlatTreeNode,
    Colors,
    FlameChartNodes,
    FlatTree,
    FlatTreeNode,
    HitRegion,
    MetaClusterizedFlatTree,
    RegionTypes,
} from '../types';
import { mergeObjects } from '../utils';
import UIPlugin from './ui-plugin';
import {
    clusterizeFlatTree,
    flatTree,
    getFlatTreeMinMax,
    metaClusterizeFlatTree,
    reclusterizeClusteredFlatTree,
} from './utils/tree-clusters';

type ClusterNode = { data: FlatTreeNode; type: string };

const DEFAULT_COLOR = Color.hsl(180, 30, 70);

export interface FlameChartPluginStyles {
    /**
     * If true, nodes will be stacked upwards.
     * This makes the chart look more like a flame chart instead of an iceberg one.
     */
    stackUpwards: boolean;
}

export type FlameChartPluginSettings = {
    styles?: Partial<FlameChartPluginStyles>;
};

export const defaultFlameChartPluginStyles: FlameChartPluginStyles = {
    stackUpwards: false,
};

export class FlameChartPlugin extends UIPlugin<FlameChartPluginStyles> {
    override styles: FlameChartPluginStyles = defaultFlameChartPluginStyles;
    height = 'flexible' as const;

    data: FlameChartNodes;
    userColors: Colors;
    flatTree: FlatTree = [];
    positionY = 0;
    colors: Colors = {};
    selectedRegion: ClusterNode | null = null;
    hoveredRegion: ClusterNode | null = null;
    lastRandomColor: typeof DEFAULT_COLOR = DEFAULT_COLOR;
    metaClusterizedFlatTree: MetaClusterizedFlatTree = [];
    actualClusterizedFlatTree: ClusterizedFlatTree = [];
    initialClusterizedFlatTree: ClusterizedFlatTree = [];
    lastUsedColor: string | null = null;
    renderChartTimeout = -1;
    maxLevel = 0;

    constructor({
        data,
        colors = {},
        name = 'flameChartPlugin',
        settings,
    }: {
        data: FlameChartNodes;
        colors?: Colors;
        name?: string;
        settings?: FlameChartPluginSettings;
    }) {
        super(name);

        this.data = data;
        this.userColors = colors;
        this.setSettings(settings);

        this.parseData();
        this.reset();
    }

    override init(renderEngine: OffscreenRenderEngine, interactionsEngine: SeparatedInteractionsEngine) {
        super.init(renderEngine, interactionsEngine);

        this.interactionsEngine.on('change-position', this.handlePositionChange.bind(this));
        this.interactionsEngine.on('select', this.handleSelect.bind(this));
        this.interactionsEngine.on('hover', this.handleHover.bind(this));
        this.interactionsEngine.on('up', this.handleMouseUp.bind(this));

        this.initData();
    }

    override setSettings(settings?: FlameChartPluginSettings) {
        this.styles = mergeObjects(defaultFlameChartPluginStyles, settings?.styles);
    }

    handlePositionChange({ deltaX, deltaY }: { deltaX: number; deltaY: number }) {
        const startPositionY = this.positionY;
        const startPositionX = this.renderEngine.parent.positionX;

        this.interactionsEngine.setCursor('grabbing');

        if (this.positionY + deltaY >= 0) {
            this.setPositionY(this.positionY + deltaY);
        } else {
            this.setPositionY(0);
        }

        this.renderEngine.tryToChangePosition(deltaX);

        if (startPositionX !== this.renderEngine.parent.positionX || startPositionY !== this.positionY) {
            this.renderEngine.parent.render();
        }
    }

    handleMouseUp() {
        this.interactionsEngine.clearCursor();
    }

    setPositionY(y: number) {
        this.positionY = y;
    }

    reset() {
        this.colors = {};
        this.lastRandomColor = DEFAULT_COLOR;

        this.positionY = 0;
        this.selectedRegion = null;
    }

    calcMinMax() {
        const { flatTree } = this;

        const { min, max } = getFlatTreeMinMax(flatTree);

        this.min = min;
        this.max = max;
        this.maxLevel = flatTree.length > 0 ? flatTree[flatTree.length - 1].level : 0;
    }

    handleSelect(region: HitRegion<ClusterizedFlatTreeNode>) {
        const selectedRegion = this.findNodeInCluster(region);

        if (this.selectedRegion !== selectedRegion) {
            this.selectedRegion = selectedRegion;

            this.renderEngine.render();

            this.emit('select', { node: this.selectedRegion?.data ?? null, type: 'flame-chart-node' });
        }
    }

    handleHover(region: HitRegion<ClusterizedFlatTreeNode>) {
        this.hoveredRegion = this.findNodeInCluster(region);
    }

    findNodeInCluster(region: HitRegion<ClusterizedFlatTreeNode>): ClusterNode | null {
        const mouse = this.interactionsEngine.getMouse();

        if (region && region.type === RegionTypes.CLUSTER) {
            const hoveredNode = region.data.nodes.find(({ level, source: { start, duration } }) => {
                const { x, y, w } = this.calcRect(start, duration, level);

                return mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + this.renderEngine.blockHeight;
            });

            if (hoveredNode) {
                return {
                    data: hoveredNode,
                    type: 'node',
                };
            }
        }

        return null;
    }

    getColor(type: string = '_default', defaultColor?: string) {
        if (defaultColor) {
            return defaultColor;
        } else if (this.colors[type]) {
            return this.colors[type];
        } else if (this.userColors[type]) {
            const color = new Color(this.userColors[type]);

            this.colors[type] = color.rgb().toString();

            return this.colors[type];
        }

        this.lastRandomColor = this.lastRandomColor.rotate(27);
        this.colors[type] = this.lastRandomColor.rgb().toString();

        return this.colors[type];
    }

    setData(data: FlameChartNodes) {
        this.data = data;

        this.parseData();
        this.initData();

        this.reset();

        this.renderEngine.recalcMinMax();
        this.renderEngine.resetParentView();
    }

    parseData() {
        this.flatTree = flatTree(this.data);

        this.calcMinMax();
    }

    initData() {
        this.metaClusterizedFlatTree = metaClusterizeFlatTree(this.flatTree);
        this.initialClusterizedFlatTree = clusterizeFlatTree(
            this.metaClusterizedFlatTree,
            this.renderEngine.zoom,
            this.min,
            this.max,
        );

        this.reclusterizeClusteredFlatTree();
    }

    reclusterizeClusteredFlatTree() {
        this.actualClusterizedFlatTree = reclusterizeClusteredFlatTree(
            this.initialClusterizedFlatTree,
            this.renderEngine.zoom,
            this.renderEngine.positionX,
            this.renderEngine.positionX + this.renderEngine.getRealView(),
        );
    }

    calcRect(start: number, duration: number, level: number) {
        const w = duration * this.renderEngine.zoom;
        const l = this.styles.stackUpwards ? this.maxLevel - level : level;

        return {
            x: this.renderEngine.timeToPosition(start),
            y: l * (this.renderEngine.blockHeight + 1) - this.positionY,
            w: w <= 0.1 ? 0.1 : w >= 3 ? w - 1 : w - w / 3,
        };
    }

    override renderTooltip() {
        if (this.hoveredRegion) {
            if (this.renderEngine.options.tooltip === false) {
                return true;
            } else if (typeof this.renderEngine.options.tooltip === 'function') {
                this.renderEngine.options.tooltip(
                    this.hoveredRegion,
                    this.renderEngine,
                    this.interactionsEngine.getGlobalMouse(),
                );
            } else {
                const {
                    data: {
                        source: { start, duration, name, children },
                    },
                } = this.hoveredRegion;
                const timeUnits = this.renderEngine.getTimeUnits();

                const selfTime = duration - (children ? children.reduce((acc, { duration }) => acc + duration, 0) : 0);

                const nodeAccuracy = this.renderEngine.getAccuracy() + 2;
                const header = `${name}`;
                const dur = `duration: ${duration.toFixed(nodeAccuracy)} ${timeUnits} ${
                    children?.length ? `(self ${selfTime.toFixed(nodeAccuracy)} ${timeUnits})` : ''
                }`;

                this.renderEngine.renderTooltipFromData(
                    [
                        { text: header },
                        { text: dur },
                        ...(!this.renderEngine.options.nonSequential
                            ? [{ text: `start: ${start.toFixed(nodeAccuracy)}` }]
                            : []),
                    ],
                    this.interactionsEngine.getGlobalMouse(),
                );
            }

            return true;
        }

        return false;
    }

    override render() {
        const { width, blockHeight, height, minTextWidth } = this.renderEngine;

        this.lastUsedColor = null;

        this.reclusterizeClusteredFlatTree();

        const processCluster = (cb: (cluster: ClusterizedFlatTreeNode, x: number, y: number, w: number) => void) => {
            return (cluster: ClusterizedFlatTreeNode) => {
                const { start, duration, level } = cluster;
                const { x, y, w } = this.calcRect(start, duration, level);

                if (x + w > 0 && x < width && y + blockHeight > 0 && y < height) {
                    cb(cluster, x, y, w);
                }
            };
        };

        const renderCluster = (cluster: ClusterizedFlatTreeNode, x: number, y: number, w: number) => {
            const { type, nodes, color, pattern, badge } = cluster;
            const mouse = this.interactionsEngine.getMouse();

            if (mouse.y >= y && mouse.y <= y + blockHeight) {
                addHitRegion(cluster, x, y, w);
            }

            if (w >= 0.25) {
                this.renderEngine.addRect({ color: this.getColor(type, color), pattern, x, y, w }, 0);

                if (badge) {
                    const badgePatternName = `node-badge-${badge}`;
                    const badgeWidth = (this.renderEngine.styles.badgeSize * 2) / Math.SQRT2;

                    this.renderEngine.createCachedDefaultPattern({
                        name: badgePatternName,
                        type: 'triangles',
                        config: {
                            color: badge,
                            width: badgeWidth,
                            align: 'top',
                            direction: 'top-left',
                        },
                    });

                    this.renderEngine.addRect(
                        {
                            pattern: badgePatternName,
                            color: 'transparent',
                            x,
                            y,
                            w: Math.min(badgeWidth, w),
                        },
                        1,
                    );
                }
            }

            if (w >= minTextWidth && nodes.length === 1) {
                this.renderEngine.addText({ text: nodes[0].source.name, x, y, w }, 2);
            }
        };

        const addHitRegion = (cluster: ClusterizedFlatTreeNode, x: number, y: number, w: number) => {
            this.interactionsEngine.addHitRegion(RegionTypes.CLUSTER, cluster, x, y, w, blockHeight);
        };

        this.actualClusterizedFlatTree.forEach(processCluster(renderCluster));

        if (this.selectedRegion && this.selectedRegion.type === 'node') {
            const {
                source: { start, duration },
                level,
            } = this.selectedRegion.data;
            const { x, y, w } = this.calcRect(start, duration, level);

            this.renderEngine.addStroke({ color: 'green', x, y, w, h: this.renderEngine.blockHeight }, 2);
        }

        clearTimeout(this.renderChartTimeout);

        this.renderChartTimeout = window.setTimeout(() => {
            this.interactionsEngine.clearHitRegions();
            this.actualClusterizedFlatTree.forEach(processCluster(addHitRegion));
        }, 16);
    }
}
