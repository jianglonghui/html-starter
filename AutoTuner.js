// 自动调优器的核心参数基因库
// 只训练驾驶算法参数，物理参数固定
// 注意：lookAheadDist 固定为18，与人类采样时的目标点一致
const FIXED_LOOK_AHEAD = 18;

const Genes = {
    steerGain: { min: 0.5, max: 3.0 },
    engineForce: { min: 2000, max: 6000 }
};

export class AutoTuner {
    constructor(populationSize = 20) {
        this.populationSize = populationSize;
        this.generation = 1;
        this.testDuration = 30000; // 每一轮测试 30 秒
        this.timer = 0;
        this.bestIndividual = null;
        this.population = this.initPopulation();
    }

    // 初始化第一代：基于学习数据或随机
    initPopulation() {
        let pop = [];
        for (let i = 0; i < this.populationSize; i++) {
            pop.push({
                id: i,
                dna: this.randomDNA(i),  // 传入索引，前几个用精确值
                fitness: 0,
                distTraveled: 0,
                avgCTE: 0,
                isAlive: true
            });
        }
        return pop;
    }

    // 生成DNA，index用于区分：前几个用精确值，后面的加变异
    randomDNA(index = -1) {
        let dna = {
            lookAheadDist: FIXED_LOOK_AHEAD  // 固定值，与人类采样一致
        };

        const learned = window.learnedPolicy;
        if (learned) {
            // 前3个个体使用精确的学习值（精英保留）
            if (index >= 0 && index < 3) {
                dna.steerGain = learned.steerGain;
                dna.engineForce = learned.engineForce;
                console.log(`个体#${index} 使用精确学习参数: steerGain=${dna.steerGain.toFixed(3)}, engineForce=${dna.engineForce.toFixed(0)}`);
            } else {
                // 其余个体在学习值基础上添加±20%变异
                const steerVariation = 0.8 + Math.random() * 0.4; // 0.8 ~ 1.2
                const forceVariation = 0.8 + Math.random() * 0.4;

                dna.steerGain = learned.steerGain * steerVariation;
                dna.engineForce = learned.engineForce * forceVariation;
            }

            // 确保在合理范围内
            dna.steerGain = Math.max(Genes.steerGain.min, Math.min(Genes.steerGain.max, dna.steerGain));
            dna.engineForce = Math.max(Genes.engineForce.min, Math.min(Genes.engineForce.max, dna.engineForce));
        } else {
            // 没有学习数据，完全随机
            for (let key in Genes) {
                dna[key] = Genes[key].min + Math.random() * (Genes[key].max - Genes[key].min);
            }
        }

        return dna;
    }

    // 评估函数：分数越高越好
    // 逻辑：行驶距离越长得分越高，CTE（偏差）越大扣分越狠，翻车直接 0 分
    calculateFitness(individual) {
        if (!individual.isAlive) return 0;
        // 分数 = 行驶距离 / (1 + 平均偏差)
        return individual.distTraveled / (1 + individual.avgCTE);
    }

    // 进化逻辑：保留前 20% 的优胜者，进行杂交和变异
    evolve() {
        // 获取人类基准（如果有）
        const humanBaseline = window.humanBaseline || { avgCTE: 2.0, avgSpeed: 15 };

        // 1. 计算最终表现
        this.population.forEach(ind => {
            const avgCTE = ind.tickCount > 0 ? ind.totalCTE / ind.tickCount : 999;
            const avgSpeed = ind.tickCount > 0 ? ind.totalSpeed / ind.tickCount : 0;

            // 适应度函数：与人类基准比较
            // CTE越接近或低于人类越好，速度越接近人类越好
            const cteScore = Math.max(0, 1 - avgCTE / (humanBaseline.avgCTE * 2));
            const distScore = ind.distTraveled / 100;
            const aliveBonus = ind.isAlive ? 1.5 : 1.0;

            ind.fitness = (cteScore * 50 + distScore * 10) * aliveBonus;
            if (ind.distTraveled < 10) ind.fitness = 0;
            ind.finalAvgCTE = avgCTE;
        });

        // 2. 排序并找出本代冠军
        this.population.sort((a, b) => b.fitness - a.fitness);
        const best = this.population[0];
        this.bestIndividual = {
            id: best.id,
            dna: { ...best.dna },
            fitness: best.fitness,
            distTraveled: best.distTraveled,
            finalAvgCTE: best.finalAvgCTE,
            isAlive: best.isAlive
        };

        // 保存最佳参数到全局，供普通模式使用
        window.bestTrainedDNA = { ...best.dna };
        console.log('%c 💾 最佳参数已保存到 window.bestTrainedDNA', 'color: #0f0;');

        // --- 打印本代汇总报告 ---
        console.group(`%c 第 ${this.generation} 代 进化报告 `, "background: #111; color: #fff; font-size: 14px;");
        console.log(`总体表现:`);
        console.table(this.population.map(ind => ({
            "ID": ind.id,
            "行驶距离": ind.distTraveled.toFixed(2) + "m",
            "平均偏差(CTE)": ind.finalAvgCTE.toFixed(3),
            "状态": ind.isAlive ? "🏁 完赛" : "💥 坠毁",
            "得分": ind.fitness.toFixed(2)
        })).slice(0, 5)); // 只看前 5 名

        console.log(`%c 🏆 最佳基因 (Best DNA): `, "color: #ff00ff; font-weight: bold;");
        console.table(this.bestIndividual.dna);
        console.groupEnd();

        // 3. 产生下一代
        let nextGen = [];
        const survivors = this.population.slice(0, Math.floor(this.populationSize * 0.2));

        // 第一个位置保留学习到的精确参数（如果有）
        const learned = window.learnedPolicy;
        if (learned) {
            nextGen.push({
                id: 0,
                dna: {
                    lookAheadDist: FIXED_LOOK_AHEAD,
                    steerGain: learned.steerGain,
                    engineForce: learned.engineForce
                },
                fitness: 0, distTraveled: 0, avgCTE: 0, isAlive: true
            });
        }

        while (nextGen.length < this.populationSize) {
            let parentA = survivors[Math.floor(Math.random() * survivors.length)].dna;
            let parentB = survivors[Math.floor(Math.random() * survivors.length)].dna;

            // 杂交 + 变异
            let childDNA = {
                lookAheadDist: FIXED_LOOK_AHEAD  // 固定值，与人类采样一致
            };
            for (let key in Genes) {
                childDNA[key] = Math.random() > 0.5 ? parentA[key] : parentB[key];
                if (Math.random() < 0.15) { // 15% 变异率
                    childDNA[key] += (Math.random() - 0.5) * (Genes[key].max - Genes[key].min) * 0.3;
                }
                // 确保在范围内
                childDNA[key] = Math.max(Genes[key].min, Math.min(Genes[key].max, childDNA[key]));
            }
            nextGen.push({ id: nextGen.length, dna: childDNA, fitness: 0, distTraveled: 0, avgCTE: 0, isAlive: true });
        }

        this.population = nextGen;
        this.generation++;
    }
}