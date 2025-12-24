export { BaseScene } from './BaseScene.js';
import { MountainRoad } from './MountainRoad.js';
import { SeaHighway } from './SeaHighway.js';

// 重新导出场景类
export { MountainRoad, SeaHighway };

// 场景列表
export const SceneList = [
    { id: 'mountain', name: '盘山公路', class: MountainRoad },
    { id: 'sea', name: '跨海公路', class: SeaHighway }
];
