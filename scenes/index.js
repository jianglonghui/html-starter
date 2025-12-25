export { BaseScene } from './BaseScene.js';
import { MountainRoad } from './MountainRoad.js';
import { SeaHighway } from './SeaHighway.js';
import { TempleIsland } from './TempleIsland.js';

// 重新导出场景类
export { MountainRoad, SeaHighway, TempleIsland };

// 场景列表
export const SceneList = [
    { id: 'mountain', name: '盘山公路', class: MountainRoad },
    { id: 'sea', name: '跨海公路', class: SeaHighway },
    { id: 'temple', name: '神庙海岛', class: TempleIsland }
];
