# 素材与许可范围

根目录的 MIT 许可适用于本项目源码、文档和维护者拥有可许可权利的原创内容。下列第三方素材继续使用各自原许可，MIT 不替代这些许可。

## 动物角色图

`dist/assets/animals.png` 是维护者提供的 AI 生成角色母版，PNG 内保留了 ChatGPT / gpt-image 的 C2PA 来源记录。维护者将自己拥有的可许可权利按 MIT 提供；没有将角色图归为音频来源的 CC0 作品。

`dist/sprites.js` 的裁切数据和界面动画属于本项目代码。`docs/gameplay.jpg` 是本项目运行截图。

## 熊猫录音：CC BY 4.0

`dist/assets/audio/panda-chirp.wav` 来自 **S2 Audio. Male chirp**，收录于 *Influence of season and social context on male giant panda vocal behaviour* (2019)。

- 作者：Benjamin D. Charlton、Megan A. Owen、Xiaoping Zhou、Hemin Zhang、Ronald R. Swaisgood。
- 来源：<https://doi.org/10.1371/journal.pone.0225772>。
- 许可：[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)。
- Copyright 2019 Charlton et al.，不暗示作者为本游戏背书。
- 改动：保留完整短鸣，转为单声道 44.1kHz PCM16 WAV，去除直流偏置，调整峰值并淡入淡出；不改变音高。游戏播放时还会进行剪裁与音量处理。

分发该录音或其改编版本时，须保留作者、来源、许可链接及改动说明。游戏内的版权入口、`CREDITS.txt` 和 `audio-sources.json` 提供相应署名。

## 用户指定的三段卡通配音：CC0

| 游戏用途与文件 | 作者、原作与来源 | 使用方式 |
| --- | --- | --- |
| 胜利 `win-battlecry2.wav` | fvcalderan，[Tiny creatures sounds / battlecry2](https://opengameart.org/content/tiny-creatures-sounds) | 加工人声口技；完整0.645563秒 |
| 水豚 `capybara-squeal.wav` | Joshua Whitney（文件ARTIST），wwstudioswastaken／原账号Foleyhaven；Technopeasant汇编。[Piglet_Squeal_01](https://freesound.org/people/wwstudioswastaken/sounds/618483/)，[Baby Animals Sounds Pack](https://opengameart.org/content/baby-animals-sounds-pack) | 用户指定的角色配音；原作是猪仔录音，并非真实水豚声；完整1.200990秒 |
| 失败 `lose-moo-notification.wav` | qubodup，[Sci-Fi Aliens and Cows Pack / moo-notification](https://opengameart.org/content/sci-fi-aliens-and-cows-pack) | 嘴部口技；完整0.950567秒 |

以上三项适用 [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)。仅转为PCM16 WAV，保留原采样率、声道和完整帧数；没有裁剪或额外变调。游戏以原播放速度播放整个文件，并调整播放音量，仍遵守既有的音效打断、静音及页面生命周期规则。源作者已施加的效果保留。原资源库保持不变。

旧输出 `win.wav`（qubodup的gameover-win）及 `lose.mp3`（WobbleBoxx Workshop的Downer01）作为未启用历史素材保留，当前游戏不再加载；对应CC0署名与来源仍在 `CREDITS.txt` 和 `audio-sources.json` 中。

## 其余音乐与音效

其余实际使用的音频分别为 CC0 或作者公有领域声明的素材。乌龟的 `turtle-shell.wav` 是 Wuzzy 录制的木骰子敲击声经过处理形成的动作拟音，**不是乌龟叫声**。

逐项作者、来源、原许可和加工记录见：

- [CREDITS.txt](dist/assets/CREDITS.txt)：包括音乐、成功/失败和消除反馈音。
- [audio-sources.json](dist/assets/audio-sources.json)：动物录音、动作拟音、当前及历史反馈音的来源、哈希、截取和处理参数。

不同文件的许可应分别遵守，不要把整个 `dist/assets/` 目录重新标为单一 MIT 或 CC0 许可。
