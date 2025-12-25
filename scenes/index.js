export { BaseScene } from './BaseScene.js';
import { MountainRoad } from './MountainRoad.js';
import { SeaHighway } from './SeaHighway.js';
import { TempleIsland } from './TempleIsland.js';
import { DesertYardang } from './DesertYardang.js';
import { Google3DTiles } from './Google3DTiles.js';

// 重新导出场景类
export { MountainRoad, SeaHighway, TempleIsland, DesertYardang, Google3DTiles };

// 场景列表
export const SceneList = [
    { id: 'mountain', name: '盘山公路', class: MountainRoad },
    { id: 'sea', name: '跨海公路', class: SeaHighway },
    { id: 'temple', name: '神庙海岛', class: TempleIsland },
    { id: 'desert', name: '沙漠魔鬼城', class: DesertYardang },
    { id: 'google3d', name: 'Google 3D城市', class: Google3DTiles }
];
