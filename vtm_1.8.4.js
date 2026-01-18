// ==UserScript==
// @name           VtM V5/V20 Rules & Character Sheet
// @author         iavas, Helium_19
// @version        1.8.4
// @description    支持V5/V20双规则，优化角色卡显示与帮助信息，优化多轮投掷输出。
// @timestamp      1768636319
// @license        Apache-2
// ==/UserScript==

if (seal.ext.find('vtm')) {
    seal.ext.unregister('vtm');
}

const ext = seal.ext.new('vtm', 'User', '1.8.2');

// --- 核心配置与辅助函数 ---

const MODE_KEY = "VtM_Rule_Settings";
const PREFIX_V5 = "v5_";
const PREFIX_V20 = "v20_";
const KEYS_LIST_V5 = "VtM_V5_Keys";
const KEYS_LIST_V20 = "VtM_V20_Keys";

function getMode(ctx) {
    let val = seal.vars.strGet(ctx, MODE_KEY)[0];
    return (val && val.length > 0) ? val : "V5";
}

function setMode(ctx, mode) {
    seal.vars.strSet(ctx, MODE_KEY, mode);
}

function getRealVarName(mode, rawName) {
    const prefix = mode === 'V5' ? PREFIX_V5 : PREFIX_V20;
    return prefix + rawName;
}

function getStorageListKey(mode) {
    return mode === 'V5' ? KEYS_LIST_V5 : KEYS_LIST_V20;
}

function updateStoredKeys(ctx, mode, keys, isDelete) {
    let listKey = getStorageListKey(mode);
    let jsonStr = seal.vars.strGet(ctx, listKey)[0];
    let stored = [];
    try {
        stored = jsonStr ? JSON.parse(jsonStr) : [];
    } catch (e) {
        stored = [];
    }

    let keySet = new Set(stored);
    
    if (Array.isArray(keys)) {
        keys.forEach(k => {
            if (isDelete) keySet.delete(k);
            else keySet.add(k);
        });
    }

    let sorted = Array.from(keySet).filter(k => k).sort();
    seal.vars.strSet(ctx, listKey, JSON.stringify(sorted));
}

function getStoredKeys(ctx, mode) {
    let listKey = getStorageListKey(mode);
    let jsonStr = seal.vars.strGet(ctx, listKey)[0];
    try {
        return jsonStr ? JSON.parse(jsonStr) : [];
    } catch (e) {
        return [];
    }
}

// --- 骰子逻辑 ---

function calculateV5Roll(pool, difficulty, hunger, label) {
    pool = Math.max(1, Math.floor(pool)); 
    difficulty = Math.max(0, Math.floor(difficulty));
    hunger = Math.max(0, Math.floor(hunger));

    let effectiveHunger = hunger;
    if (effectiveHunger > pool) effectiveHunger = pool;
    
    const normalDiceCount = pool - effectiveHunger;

    let normalResults = [];
    let hungerResults = [];
    let successes = 0;
    let tenCount = 0;
    let hungerTen = false; 
    let hungerOne = false; 

    for (let i = 0; i < normalDiceCount; i++) {
        const roll = Math.floor(Math.random() * 10) + 1;
        normalResults.push(roll);
        if (roll >= 6) successes++;
        if (roll === 10) tenCount++;
    }

    for (let i = 0; i < effectiveHunger; i++) {
        const roll = Math.floor(Math.random() * 10) + 1;
        hungerResults.push(roll);
        if (roll >= 6) successes++;
        if (roll === 10) { 
            tenCount++; 
            hungerTen = true; 
        }
        if (roll === 1) hungerOne = true;
    }

    const critPairs = Math.floor(tenCount / 2);
    successes += (critPairs * 2);

    let statusText = "";
    const isWin = successes >= difficulty;
    const hasCrit = critPairs > 0;

    if (isWin) {
        if (hasCrit && hungerTen) statusText = "兽性暴击";
        else if (hasCrit) statusText = "暴击胜利";
        else statusText = `胜利 (余数 ${successes - difficulty})`;
    } else {
        if (hungerOne) statusText = "兽性失败";
        else if (successes === 0 && normalResults.length + hungerResults.length > 0) statusText = "彻底失败";
        else if (successes === 0) statusText = "失败"; 
        else statusText = `失败 (缺数 ${difficulty - successes})`;
    }

    let title = label ? `\nVtM V5 检定: ${label}` : `\nVtM V5 检定`;
    let detail = `(骰池${pool} | 难度${difficulty} | 饥渴${effectiveHunger})`;
    
    let output = `${title} ${detail}\n`;
    if (normalResults.length > 0) output += `普通骰: [${normalResults.join(",")}]\n`;
    if (hungerResults.length > 0) output += `饥渴骰: [${hungerResults.join(",")}]`;
    
    let critText = critPairs > 0 ? ` (含${critPairs}组暴击)` : "";
    output += `\n结果: ${successes}成功${critText} -> ${statusText}`;
    
    return output;
}

function calculateV20Roll(pool, difficulty, label) {
    let allRolls = [];
    let successes = 0;
    let ones = 0;
    let initialSuccessCount = 0;

    function rollV20Recursive(count) {
        let newRolls = [];
        for (let i = 0; i < count; i++) {
            let r = Math.floor(Math.random() * 10) + 1;
            newRolls.push(r);
            if (r >= difficulty) {
                successes++;
                initialSuccessCount++;
            }
            if (r === 1) ones++;
            if (r === 10) {
                let exploded = rollV20Recursive(1);
                newRolls = newRolls.concat(exploded);
            }
        }
        return newRolls;
    }

    allRolls = rollV20Recursive(pool);
    let netSuccesses = successes - ones;
    let resultStatus = "";
    
    if (netSuccesses > 0) {
        resultStatus = `成功 (净成功数: ${netSuccesses})`;
    } else {
        if (initialSuccessCount === 0 && ones > 0) {
            resultStatus = "大失败";
        } else {
            resultStatus = "失败";
        }
    }

    let title = label ? `\nVtM V20 检定: ${label}` : `\nVtM V20 检定`;
    let output = `${title} (骰池${pool} | 难度${difficulty})\n`;
    output += `掷骰: [${allRolls.join(",")}]\n`;
    output += `统计: ${successes}成功 - ${ones}个骰子为1 -> ${resultStatus}`;

    return output;
}

// --- 角色卡显示逻辑 ---

// 标准字段定义
const STD_V5 = {
    attrs: {
        "生理": ["力量", "敏捷", "体质"],
        "社会": ["魅力", "操控", "沉着"],
        "心智": ["智力", "机智", "决心"]
    },
    skills: {
        "生理": ["运动", "肉搏", "驾驶", "枪械", "盗窃", "白刃", "潜行", "生存", "手艺"],
        "社会": ["驯兽", "礼仪", "洞悉", "威吓", "领导", "表演", "说服", "街头", "欺瞒"],
        "心智": ["学术", "觉察", "金融", "调查", "医疗", "神秘", "政治", "科学", "科技"]
    },
    core: ["HP", "HPMax", "意志力", "意志力Max", "人性", "饥渴"]
};

const STD_V20 = {
    attrs: {
        "生理": ["力量", "敏捷", "耐力"],
        "社会": ["魅力", "操控", "外貌"],
        "心智": ["感知", "智力", "机智"]
    },
    abilities: {
        "天赋": ["警觉", "运动", "格斗", "理解", "超感", "表达", "胁迫", "领导", "黑街", "掩饰"],
        "技能": ["驯兽", "手艺", "驾驶", "礼仪", "枪械", "白刃", "表演", "潜行", "生存", "盗窃"],
        "知识": ["学术", "电脑", "金融", "调查", "法律", "医学", "神秘", "政治", "科学", "科技"]
    },
    virtues: ["良知/坚信", "自控/本能", "勇气"],
    core: ["血池", "血池Max", "意志力", "意志力Max", "人性/心路等级"]
};

function formatKV(key, val) {
    return `${key}${val}`;
}

function showCharacterSheet(ctx, msg, mode) {
    const getVal = (k) => seal.vars.intGet(ctx, getRealVarName(mode, k))[0];
    const storedKeys = new Set(getStoredKeys(ctx, mode));
    
    // 追踪哪些Key已经被显示过了，最后剩下的放入"其他"
    const usedKeys = new Set();

    const divider = "------------------";
    
    let output = `【${ctx.player.name}】${mode}角色卡\n`;

    if (mode === 'V5') {
        // 1. 核心状态
        let hp = getVal("HP"), hpMax = getVal("HPMax");
        let wp = getVal("意志力"), wpMax = getVal("意志力Max");
        let hum = getVal("人性"), hun = getVal("饥渴");
        
        output += `HP: ${hp}/${hpMax}  意志力: ${wp}/${wpMax}\n`;
        output += `人性: ${hum}  饥渴: ${hun}\n${divider}\n`;
        
        STD_V5.core.forEach(k => usedKeys.add(k));

        // 2. 属性
        let attrRows = [];
        ["生理", "社会", "心智"].forEach(cat => {
            let row = `${cat}属性: `;
            let items = STD_V5.attrs[cat].map(k => {
                usedKeys.add(k);
                return formatKV(k, getVal(k));
            });
            attrRows.push(row + items.join(" "));
        });
        output += attrRows.join("\n") + `\n${divider}\n`;

        // 3. 技能
        let skillRows = [];
        ["生理", "社会", "心智"].forEach(cat => {
            let row = `${cat}技能: `;
            let items = [];
            STD_V5.skills[cat].forEach(k => {
                usedKeys.add(k);
                items.push(formatKV(k, getVal(k)));
            });
            skillRows.push(row + items.join(" "));
        });
        output += skillRows.join("\n");

    } else { // V20
        // 1. 核心状态
        let bp = getVal("血池"), bpMax = getVal("血池Max");
        let wp = getVal("意志力"), wpMax = getVal("意志力Max");
        let hum = getVal("人性/心路等级");
        
        output += `血池: ${bp}/${bpMax}  意志力: ${wp}/${wpMax}\n`;
        output += `人性/心路等级: ${hum}\n${divider}\n`;
        
        STD_V20.core.forEach(k => usedKeys.add(k));

        // 2. 属性
        let attrRows = [];
        ["生理", "社会", "心智"].forEach(cat => {
            let row = `${cat}属性: `;
            let items = STD_V20.attrs[cat].map(k => {
                usedKeys.add(k);
                return formatKV(k, getVal(k));
            });
            attrRows.push(row + items.join(" "));
        });
        output += attrRows.join("\n") + `\n${divider}\n`;

        // 3. 能力
        let abRows = [];
        ["天赋", "技能", "知识"].forEach(cat => {
            let row = `${cat}: `;
            let items = STD_V20.abilities[cat].map(k => {
                usedKeys.add(k);
                return formatKV(k, getVal(k));
            });
            abRows.push(row + items.join(" "));
        });
        output += abRows.join("\n");

        // 4. 美德
        let virText = "美德: ";
        let virItems = [];
        STD_V20.virtues.forEach(k => {
            if (storedKeys.has(k)) {
                usedKeys.add(k);
                virItems.push(formatKV(k, getVal(k)));
            }
        });
        if (virItems.length > 0) {
             output += `\n${divider}\n` + virText + virItems.join(" ");
        }
    }

    // 5. 其他 (自定义项)
    let otherItems = [];
    storedKeys.forEach(k => {
        if (!usedKeys.has(k)) {
            otherItems.push(formatKV(k, getVal(k)));
        }
    });

    if (otherItems.length > 0) {
        output += `\n${divider}\n其他: ${otherItems.join(" ")}`;
    }

    seal.replyToSender(ctx, msg, output);
}

// --- 通用命令处理 ---

function handleSTCommand(ctx, msg, cmdArgs, targetMode) {
    let rawArgs = "";
    for (let i = 1; i <= 500; i++) {
        let arg = cmdArgs.getArgN(i);
        if (!arg) break;
        rawArgs += arg + " ";
    }
    rawArgs = rawArgs.trim();

    if (rawArgs === 'd!!!') {
        seal.vars.strSet(ctx, getStorageListKey(targetMode), "[]");
        const coreReset = ["HP", "HPMax", "意志力", "意志力Max", "人性", "饥渴", "血池", "血池Max"];
        coreReset.forEach(k => seal.vars.intSet(ctx, getRealVarName(targetMode, k), 0));
        seal.replyToSender(ctx, msg, `【VtM】${targetMode} 角色数据已全部清空。`);
        return;
    }

    if (!rawArgs) {
        showCharacterSheet(ctx, msg, targetMode);
        return;
    }

    rawArgs = rawArgs.replace(/＝/g, '=');
    let tokens = rawArgs.split(/\s+/);
    let setList = [], delList = [], setKeys = [], delKeys = [];

    for (let token of tokens) {
        if (token.indexOf('=') > -1) {
            let parts = token.split('=');
            let key = parts[0];
            let val = parseInt(parts[1]);
            if (key && !isNaN(val)) {
                seal.vars.intSet(ctx, getRealVarName(targetMode, key), val);
                setList.push(`${key}=${val}`);
                setKeys.push(key);
            }
        } else if (token.startsWith('d') && token.length > 1) {
            let key = token.substring(1);
            seal.vars.intSet(ctx, getRealVarName(targetMode, key), 0);
            delList.push(key);
            delKeys.push(key);
        }
    }

    if (setKeys.length > 0) updateStoredKeys(ctx, targetMode, setKeys, false);
    if (delKeys.length > 0) updateStoredKeys(ctx, targetMode, delKeys, true);

    if (setList.length === 0 && delList.length === 0) {
        seal.replyToSender(ctx, msg, `指令格式错误。\n查看: .vst\n录入: .vst 力量=3\n删除: .vst d力量`);
    } else {
        let output = "";
        if (setList.length > 0) output += `录入[${targetMode}]: ${setList.join(", ")}\n`;
        if (delList.length > 0) output += `删除[${targetMode}]: ${delList.join(", ")}`;
        seal.replyToSender(ctx, msg, `更新完毕:\n${output.trim()}`);
    }
}

function handleAutoCheck(ctx, msg, cmdArgs, targetMode) {
    let rawArgs = "";
    for (let i = 1; i <= 100; i++) {
        let arg = cmdArgs.getArgN(i);
        if (!arg) break;
        rawArgs += arg;
    }
    
    // 预处理
    rawArgs = rawArgs.replace(/\s+/g, '').toLowerCase();
    rawArgs = rawArgs.replace(/＋/g, '+').replace(/ｋ/g, 'k');

    if (!rawArgs) {
         seal.replyToSender(ctx, msg, `格式错误。请使用: .va {属性+技能}k{难度} (可选: n# 表示投掷n次)`);
         return;
    }

    // 处理重复次数逻辑 #
    let repeatCount = 1;
    if (rawArgs.includes('#')) {
        let splitArr = rawArgs.split('#');
        let r = parseInt(splitArr[0]);
        if (!isNaN(r) && r > 0) repeatCount = r;
        // 限制最大次数以防刷屏
        if (repeatCount > 10) repeatCount = 10;
        rawArgs = splitArr[1] || "";
    }

    if (!rawArgs) {
        seal.replyToSender(ctx, msg, `格式错误: 指定次数后未输入判定内容。`);
        return;
    }

    if (!rawArgs.includes('k')) {
        rawArgs += "k" + (targetMode === 'V5' ? "0" : "6"); 
    }

try {
        const parts = rawArgs.split('k');
        const equationStr = parts[0];
        let difficulty = 0;
        if (parts[1]) difficulty = parseInt(parts[1]);
        if (isNaN(difficulty)) difficulty = targetMode === 'V5' ? 0 : 6;
        if (targetMode === 'V20' && difficulty === 0) difficulty = 6;

        const statParts = equationStr.split('+');
        let totalPool = 0;
        let expressionText = "";

        for (let part of statParts) {
            if (!part) continue;
            if (/^\d+$/.test(part)) {
                let val = parseInt(part);
                totalPool += val;
                expressionText += `${val}+`;
            } else {
                let realName = getRealVarName(targetMode, part); 
                let val = seal.vars.intGet(ctx, realName)[0];
                totalPool += val;
                expressionText += `${part}(${val})+`;
            }
        }
        
        if (expressionText.endsWith('+')) expressionText = expressionText.slice(0, -1);

        let finalOutput = "";
        
        if (targetMode === 'V5') {
            let hunger = seal.vars.intGet(ctx, getRealVarName('V5', "饥渴"))[0];
            for (let i = 0; i < repeatCount; i++) {
                 let res = calculateV5Roll(totalPool, difficulty, hunger, expressionText);
                 if (repeatCount > 1) {
                     // 多轮投掷：首行直接加编号，后续行加双换行分隔+编号
                     let header = (i === 0) ? `【第 ${i+1} 次】` : `\n\n【第 ${i+1} 次】`;
                     finalOutput += header + res;
                 } else {
                     finalOutput += res;
                 }
            }
        } else {
            for (let i = 0; i < repeatCount; i++) {
                let res = calculateV20Roll(totalPool, difficulty, expressionText);
                if (repeatCount > 1) {
                    let header = (i === 0) ? `【第 ${i+1} 次】` : `\n\n【第 ${i+1} 次】`;
                    finalOutput += header + res;
                } else {
                    finalOutput += res;
                }
            }
        }
        
        seal.replyToSender(ctx, msg, finalOutput);

    } catch (e) {
        seal.replyToSender(ctx, msg, `执行出错: ${e.message}`);
    }
}

// --- 指令注册 ---

// 1. VTM 帮助指令
const cmdVtM = seal.ext.newCmdItemInfo();
cmdVtM.name = 'vtm';
cmdVtM.help = 'VtM 工具箱, h=简明帮助，help=详细帮助';
cmdVtM.solve = (ctx, msg, cmdArgs) => {
    let val = cmdArgs.getArgN(1);
    if (val === 'h') {
        let helpText = `【简明帮助，详细帮助请使用 .vtm help】
1. 切换模式
   .vset v5  -> 切换至第五版规则 (默认)
   .vset v20 -> 切换至20周年版规则

2. 录入数据 (.vst)
   会根据当前模式分别存储，互不冲突。
   .vst              -> 查看当前模式角色卡
   .vst 力量=3 射击=4 -> 录入项目 (自动覆盖更新)
   .vst d射击         -> 删除项目
   .vst d!!!         -> 【清空】当前模式当前角色的所有数据

3. 快速检定 (.va)
   自动调用已录入的属性值进行加骰。
   .va 敏捷+潜行      -> V5默认难度0，V20默认难度6
   .va 4#力量+肉搏k4  -> 重复投掷4次，指定难度为4

4. 手动掷骰
   .vv 5k2k1   -> (V5) 5个骰子，难度2，1点饥渴
   .vxx 3#6k7  -> (V20) 重复3次，6个骰子，难度7

5. 显式指令 (不随模式切换)
   .v5st / .v20st  -> 强制操作特定版本人物卡
   .v5a / .v20a    -> 强制使用特定版本规则检定
`;
        seal.replyToSender(ctx, msg, helpText);
        return seal.ext.newCmdExecuteResult(true);
    }
    if (val === 'help') {
        let helpText = `【详细帮助，简明帮助请使用 .vtm h】
.vtm help

VtM网团常用指令
.bot on 开启骰子
.bot off 关闭骰子
.set10 将默认骰子面数设置为10
.nn 修改用户在log中的名称
.log new 开启新log
.log on 继续正在运行的log
.log off 暂停正在运行的log
.log end 结束正在运行的log并输出日志服务器地址
.dismiss@骰子名称 让骰子自动退群 

本骰独有的VtM检定指令
*请注意游玩版本差异，目前支持VtM5版及VtM20周年纪念版

.ext vtm on 启动插件
.ext vtm off 关闭插件

简易掷骰
.vv 骰池k难度k饥渴 VtM第五版检定掷骰
例：玩家要使用血魔术技能吮血知味，骰池为智力+血魔术，难度为3。玩家的智力为4，血魔术等级为3，饥渴值为2，则输入指令为.vv 7k3k2
支持多重投掷：.vv 3#7k3k2 (重复3次)

.vxx 骰池k难度 VtM20周年纪念版检定掷骰
例：玩家要使用支配术技能催眠，骰池为操纵+领导，难度为5（目标的意志点数）。玩家的操纵为4，领导为2，则输入指令为.vxx 6k5
支持多重投掷：.vxx 4#6k5 (重复4次)

切换规则版本
.vset 查看当前规则（V5/V20）
.vset v5 设置为V5规则（或.vset vv）
.vset v20 设置为V20规则（或.vset vxx）

切换规则版本后可进行角色数据录入。

VtM第五版规则人物卡数据录入：
.vst 力量=0 敏捷=0 体质=0 魅力=0 操控=0 沉着=0 智力=0 机智=0 决心=0 HP=0 HPMax=0 意志力=0 意志力Max=0 人性=0 饥渴=1 运动=0 肉搏=0 手艺=0 驾驶=0 枪械=0 盗窃=0 白刃=0 潜行=0 生存=0 驯兽=0 礼仪=0 洞悉=0 威吓=0 领导=0 表演=0 说服=0 街头=0 欺瞒=0 学术=0 觉察=0 金融=0 调查=0 医疗=0 神秘=0 政治=0 科学=0 科技=0 支配术=0 血魔术=0 观占术=0
*律能类别可自行增加，未录入的默认为0。

录卡后相关指令
.vst 查看当前规则的角色卡
.vst 项目=值 将属性值录入角色卡（或更新角色卡中已有的同名属性值）
.vst d项目 删除角色卡中的指定属性
.vst d!!! 删除角色卡

录卡后检定
.va属性+技能k难度 成功录卡后，自动调用卡中的骰池和饥渴值进行检定，多个属性/技能之间以加号连接，也可直接使用数字作为骰池加值。例：.va敏捷+白刃k4；.va敏捷+4k4
多重检定：.va 3#敏捷+白刃k4 (进行3次判定)

VtM20周年纪念版规则人物卡数据录入：
.vst 力量=0 敏捷=0 耐力=0 魅力=0 操控=0 外貌=0 感知=0 智力=0 机智=0 意志力=0 意志力Max=0 人性/心路等级=0 血池=0 血池Max=0 警觉=0 运动=0 超感=0 格斗=0 理解=0 表达=0 胁迫=0 领导=0 黑街=0 掩饰=0 驯兽=0 手艺=0 驾驶=0 礼仪=0 枪械=0 盗窃=0 白刃=0 表演=0 潜行=0 生存=0 学术=0 电脑=0 金融=0 调查=0 法律=0 医学=0 神秘=0 政治=0 科学=0 科技=0 良知/坚信=0 自控/本能=0 勇气=0
*律能类别可自行增加，未录入的默认为0。

录卡后相关指令
.vst 查看当前规则的角色卡
.vst 项目=值 将项目值录入角色卡（或更新角色卡中已有的同名项目值）
.vst d项目 删除角色卡中的指定项目
.vst d!!! 删除角色卡

录卡后检定
.va属性+技能k难度 成功录卡后，自动调用卡中的骰池进行检定，多个属性/技能之间以加号连接，也可直接使用数字作为骰池加值。例：.va敏捷+白刃k6；.va敏捷+4k6
多重检定：.va 3#敏捷+白刃k6

其他
.v5st 无视当前规则设定，访问并操作V5角色卡
.v20st 无视当前规则设定，访问并操作V20角色卡
.v5a 无视当前规则设定，使用V5角色卡进行检定
.v20a 无视当前规则设定，使用V20角色卡进行检定
`;
        seal.replyToSender(ctx, msg, helpText);
        return seal.ext.newCmdExecuteResult(true);
    }
    return seal.ext.newCmdExecuteResult(true);
};

// 2. 基础掷骰
const cmdVV = seal.ext.newCmdItemInfo();
cmdVV.name = 'vv';
cmdVV.help = 'V5掷骰: .vv [次数#]<骰池>k<难度>k<饥渴>';
cmdVV.solve = (ctx, msg, cmdArgs) => {
    let rawArgs = "";
    for(let i=1;i<=5;i++) { let a=cmdArgs.getArgN(i); if(!a) break; rawArgs+=a; }
    rawArgs = rawArgs.trim().toLowerCase().replace(/ｋ/g, 'k');

    let repeatCount = 1;
    if (rawArgs.includes('#')) {
        let splitArr = rawArgs.split('#');
        let r = parseInt(splitArr[0]);
        if (!isNaN(r) && r > 0) repeatCount = r;
        if (repeatCount > 20) repeatCount = 20; // 纯掷骰上限放宽为20次
        rawArgs = splitArr[1] || "";
    }

    const parts = rawArgs.split('k');
    if(parts.length<2) { seal.replyToSender(ctx,msg,"格式: .vv [次数#]<骰池>k<难度>k<饥渴>"); return seal.ext.newCmdExecuteResult(true); }
    const pool = parseInt(parts[0]||0), diff = parseInt(parts[1]||0), hun = parseInt(parts[2]||0);

    let output = "";
    for(let i=0; i<repeatCount; i++) {
        let res = calculateV5Roll(pool, diff, hun, "");
        if (repeatCount > 1) {
            // 第1次不加空行，后续加空行分隔
            let header = (i === 0) ? `【第 ${i+1} 次】` : `\n\n【第 ${i+1} 次】`;
            output += header + res;
        } else {
            output += res;
        }
    }
    seal.replyToSender(ctx, msg, output);
    return seal.ext.newCmdExecuteResult(true);
};

const cmdVXX = seal.ext.newCmdItemInfo();
cmdVXX.name = 'vxx';
cmdVXX.help = 'V20掷骰: .vxx [次数#]<骰池>k<难度>';
cmdVXX.solve = (ctx, msg, cmdArgs) => {
    let rawArgs = "";
    for(let i=1;i<=3;i++) { let a=cmdArgs.getArgN(i); if(!a) break; rawArgs+=a; }
    rawArgs = rawArgs.trim().toLowerCase().replace(/ｋ/g, 'k');

    let repeatCount = 1;
    if (rawArgs.includes('#')) {
        let splitArr = rawArgs.split('#');
        let r = parseInt(splitArr[0]);
        if (!isNaN(r) && r > 0) repeatCount = r;
        if (repeatCount > 20) repeatCount = 20; 
        rawArgs = splitArr[1] || "";
    }

    const parts = rawArgs.split('k');
    const pool = parseInt(parts[0]), diff = parseInt(parts[1]);
    if(isNaN(pool)||isNaN(diff)) { seal.replyToSender(ctx,msg,"格式: .vxx [次数#]<骰池>k<难度>"); return seal.ext.newCmdExecuteResult(true); }
    
    let output = "";
    for(let i=0; i<repeatCount; i++) {
        let res = calculateV20Roll(pool, diff, "");
        if (repeatCount > 1) {
            let header = (i === 0) ? `【第 ${i+1} 次】` : `\n\n【第 ${i+1} 次】`;
            output += header + res;
        } else {
            output += res;
        }
    }
    seal.replyToSender(ctx, msg, output);
    return seal.ext.newCmdExecuteResult(true);
};

// 3. 智能指令
const cmdVST = seal.ext.newCmdItemInfo();
cmdVST.name = 'vst';
cmdVST.help = '录卡/查看: .vst (参考 .vtm help)';
cmdVST.solve = (ctx, msg, cmdArgs) => {
    const mode = getMode(ctx);
    handleSTCommand(ctx, msg, cmdArgs, mode);
    return seal.ext.newCmdExecuteResult(true);
};

const cmdVA = seal.ext.newCmdItemInfo();
cmdVA.name = 'va';
cmdVA.help = '检定: .va (参考 .vtm help)';
cmdVA.solve = (ctx, msg, cmdArgs) => {
    const mode = getMode(ctx);
    handleAutoCheck(ctx, msg, cmdArgs, mode);
    return seal.ext.newCmdExecuteResult(true);
};

// 4. 显式指令
const cmdV5ST = seal.ext.newCmdItemInfo();
cmdV5ST.name = 'v5st';
cmdV5ST.help = 'V5专用录卡';
cmdV5ST.solve = (ctx, msg, cmdArgs) => { handleSTCommand(ctx, msg, cmdArgs, 'V5'); return seal.ext.newCmdExecuteResult(true); };

const cmdV20ST = seal.ext.newCmdItemInfo();
cmdV20ST.name = 'v20st';
cmdV20ST.help = 'V20专用录卡';
cmdV20ST.solve = (ctx, msg, cmdArgs) => { handleSTCommand(ctx, msg, cmdArgs, 'V20'); return seal.ext.newCmdExecuteResult(true); };

const cmdV5A = seal.ext.newCmdItemInfo();
cmdV5A.name = 'v5a';
cmdV5A.help = 'V5专用检定';
cmdV5A.solve = (ctx, msg, cmdArgs) => { handleAutoCheck(ctx, msg, cmdArgs, 'V5'); return seal.ext.newCmdExecuteResult(true); };

const cmdV20A = seal.ext.newCmdItemInfo();
cmdV20A.name = 'v20a';
cmdV20A.help = 'V20专用检定';
cmdV20A.solve = (ctx, msg, cmdArgs) => { handleAutoCheck(ctx, msg, cmdArgs, 'V20'); return seal.ext.newCmdExecuteResult(true); };

const cmdSetVtM = seal.ext.newCmdItemInfo();
cmdSetVtM.name = 'vset';
cmdSetVtM.help = '设置VtM模式: .vset v5 或 .vset v20';
cmdSetVtM.solve = (ctx, msg, cmdArgs) => {
    let val = cmdArgs.getArgN(1);
    if (!val || val === "help") {
        const current = getMode(ctx);
        seal.replyToSender(ctx, msg, `当前VtM规则: ${current}\n切换指令: .vset v5 或 .vset v20`);
        return seal.ext.newCmdExecuteResult(true);
    }
    let subCmd = val.toLowerCase();
    if (subCmd === 'v5' || subCmd === 'vv') {
        setMode(ctx, 'V5');
        seal.replyToSender(ctx, msg, "VtM规则已切换为: V5");
    } else if (subCmd === 'v20' || subCmd === 'vxx') {
        setMode(ctx, 'V20');
        seal.replyToSender(ctx, msg, "VtM规则已切换为: V20");
    } else {
        seal.replyToSender(ctx, msg, "未知模式，请使用 .vset v5 或 .vset v20");
    }
    return seal.ext.newCmdExecuteResult(true);
};

ext.cmdMap['vtm'] = cmdVtM;
ext.cmdMap['vv'] = cmdVV;
ext.cmdMap['vxx'] = cmdVXX;
ext.cmdMap['vst'] = cmdVST;
ext.cmdMap['va'] = cmdVA;
ext.cmdMap['v5st'] = cmdV5ST;
ext.cmdMap['v20st'] = cmdV20ST;
ext.cmdMap['v5a'] = cmdV5A;
ext.cmdMap['v20a'] = cmdV20A;
ext.cmdMap['vset'] = cmdSetVtM;

seal.ext.register(ext);