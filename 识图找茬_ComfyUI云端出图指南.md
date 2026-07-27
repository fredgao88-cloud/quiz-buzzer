# 识图找茬场景图 · ComfyUI Cloud 出图指南

5 张图（图A ~ 图E），每张 10 处违规，**与现有题库逐条对应，题库未做任何改动**。

---

## 一、结论先行：用哪套工作流

ComfyUI 上补违规有两条路，**按你的情况选第一条**：

| | ⭐ 路线1 指令式编辑 | 路线2 蒙版局部重绘 |
|---|---|---|
| 模型 | **Flux.1 Kontext** 或 **Qwen-Image-Edit** | Flux Fill / SDXL Inpainting |
| 怎么用 | 上传图 + 打一句话「加个 XX，其他不变」 | 要自己涂蒙版、调 denoise |
| 上手难度 | 低，和 Gemini 差不多 | 中，要理解蒙版和重绘幅度 |
| 精度 | 位置靠描述，偶尔跑偏 | 位置精确 |
| **推荐** | **先全用这条** | 只在某处反复画不对时才用 |

**Qwen-Image-Edit 认中文**——如果 Cloud 上有这个模型，可以直接粘我之前那份中文提示词，省掉翻译。
**Flux.1 Kontext 只认英文**——用下面第三、四节的英文版。

### 两阶段流程

```
阶段一：文生图 → 出一张「场景 + 4~5 处大件违规」的基底图
   ↓ 下载 / 直接接到下一步
阶段二：指令式编辑 → 分 2 轮把剩下的违规加上去
   ↓
产出 图A.png ~ 图E.png
```

### ComfyUI Cloud 模板对应表

在模板库里搜 `flux.1 dev`，按下表挑：

| 用途 | 模板名 | 说明 |
|---|---|---|
| **阶段一 出基底图** | **`Flux.1 开发专用：文生图`** | 主力。想要更强的真实照片感可先试 `Flux.1 Krea Dev`（专门调过去 AI 塑料感） |
| **阶段二 补违规** | **`Flux Kontext Dev 图像编辑`** | 主力。就是指令式编辑，上传图 + 打一句话 |
| 兜底：蒙版局部重绘 | `Flux.1 Dev OneReward` | 标签「图像修复/外绘」，指令式画不对时才用 |
| 五张风格统一（可选） | `Flux.1 USO 参考图生成` | 拿定稿的图A 当参考图去跑 B~E |

> **fp8 版**（`Flux.1 开发专用 fp8：文生图`）只是精度压缩，更快更省，质量差别很小。
> 只有 5 张图，建议直接用非 fp8 的，别为这点时间牺牲画质。

---

## 二、ComfyUI Cloud 上的具体操作

### 阶段一：文生图

1. 模板库搜 `flux.1 dev` → 选 **`Flux.1 开发专用：文生图`**
2. 把第三节对应图的 **Base Prompt** 粘进正向提示词框（`CLIP Text Encode` 节点）
3. 分辨率设 **1344 × 768**（≈16:9；也可以用 1920×1088）
4. 参数：

| 参数 | 值 |
|---|---|
| Steps | 25 ~ 30 |
| CFG / Guidance | Flux: 3.5；SDXL: 6 ~ 7 |
| Sampler | euler / dpmpp_2m |
| Scheduler | simple / karras |
| Seed | **记下来**，同一场景想微调时能复现 |

5. 跑 3~4 张，挑一张**构图开阔、人物分散、留白多**的。留白就是后面加违规的地方。

### 阶段二：指令式编辑

1. 模板库选 **`Flux Kontext Dev 图像编辑`**
2. `Load Image` 节点上传阶段一选中的图
3. 提示词框粘第四节的 **Round 2 / Round 3** 指令
4. 参数：

| 参数 | 值 |
|---|---|
| Steps | 20 ~ 28 |
| Guidance | 2.5 ~ 4.0（太高会整张重画） |
| **Denoise** | **1.0**（Kontext 类模型固定 1.0，靠指令控制改动范围，不是靠 denoise） |

5. **一次只喂 2~3 处**，出图后把结果重新 Load 进去，再喂下一批

> ⚠️ 每条指令都必须带 **`keep everything else in the image completely unchanged`**。
> 不带这句，模型会顺手重画整张图，前面对的地方全没了。

---

## 三、五张图的基底图提示词（英文，阶段一用）

每张第 1 轮只放 **4~5 处最占画面的大件违规**——一次喂 10 个，模型必然注意力涣散，
只画出 4~5 个，或者把几个特征缝到同一个人身上。

### 图A · 收银区

对应题库：① 刘海遮眼 ② 未戴工牌 ③ 倚靠收银台 ④ 双手插兜 ⑤ 看手机 ⑥ 未问候顾客 ⑦ 地面纸屑 ⑧ 货架积灰 ⑨ 卖场进食 ⑩ 纸箱挡安全牌

```
Wide-angle eye-level photograph of the checkout area inside a modern Chinese
department store, bright even commercial lighting, photorealistic, 16:9.
Staff wear matching navy blue vests over white shirts. A checkout counter on the
left, product shelves along the right wall, the store entrance visible in the
upper right background. People are spread far apart across the frame and do not
overlap each other.

In the centre-left a staff member leans sideways against the edge of the checkout
counter, resting his body weight on it. In the centre a staff member stares down
at a smartphone in his hand while a customer stands directly in front of him
talking to him. On the lower left a large conspicuous pile of scattered paper
scraps and crumpled paper balls litters the floor. On the lower right a staff
member is eating from an open lunch box on the sales floor, chopsticks raised to
his mouth. At the far right, four large stacked cardboard boxes are placed
directly beneath a green emergency exit sign, blocking the passage.

The walls and shelves are completely blank without any text, letters, logos or
signage. Correct human anatomy, normal hands and feet, no extra fingers or limbs.
```

### 图B · 服装区

对应题库：① 衬衫未扎 ② 夸张项链耳环 ③ 交叉抱臂 ④ 坐货柜上 ⑤ 背对顾客 ⑥ 聊天忽视顾客 ⑦ 试衣间脏乱 ⑧ 标签破损 ⑨ 私自离岗 ⑩ 电源线横过道

```
Wide-angle eye-level photograph of the clothing section inside the same modern
Chinese department store, bright even commercial lighting, photorealistic, 16:9.
Staff wear matching navy blue vests over white shirts. Fitting rooms on the right,
display counters and clothing racks in the middle. People are spread far apart
across the frame and do not overlap each other.

In the centre a staff member sits on top of a product display counter with his
legs dangling over the edge. In the upper right two staff members stand face to
face chatting and laughing while a customer beside them raises a hand for
attention and is completely ignored. On the right a fitting room door stands half
open with clothes, hangers and litter strewn across the floor inside. In the lower
centre an unattended empty service desk with an empty chair, a customer waiting
alone in front of it. On the lower right a thick black rubber cable lies loose
right across the middle of the customer walkway on the floor.

The walls and shelves are completely blank without any text, letters, logos or
signage. Correct human anatomy, normal hands and feet, no extra fingers or limbs.
```

### 图C · 化妆品区

对应题库：① 口红夸张 ② 头发披肩 ③ 单腿倚柱 ④ 趴收银台 ⑤ 不文明用语 ⑥ 未打包装袋 ⑦ 货架杂乱 ⑧ 镜面污迹 ⑨ 互相嬉闹 ⑩ 灭火器被挡

```
Wide-angle eye-level photograph of the cosmetics section inside the same modern
Chinese department store, bright even commercial lighting, photorealistic, 16:9.
Staff wear matching navy blue vests over white shirts. A square structural column
and a large wall mirror are visible, a checkout counter in the middle. People are
spread far apart across the frame and do not overlap each other.

In the centre a staff member is slumped face down over the checkout counter,
resting his chin on his hands. In the centre-left a staff member leans against the
column with one foot propped up against it. On the right a shelf section is in
complete disarray, products tilted and facing random directions with visible gaps.
In the lower centre two staff members are goofing around, waving their arms wildly
and pulling faces at each other. On the lower right a red fire extinguisher is
almost entirely hidden behind stacked cardboard boxes, only a small corner visible.

The walls and shelves are completely blank without any text, letters, logos or
signage. No speech bubbles. Correct human anatomy, normal hands and feet, no extra
fingers or limbs.
```

### 图D · 收银台与靠窗区

对应题库：① 穿拖鞋 ② 工牌贴错位置 ③ 坐地整货 ④ 手插兜接待 ⑤ 找零未点清 ⑥ 投诉冷漠 ⑦ 玻璃水渍 ⑧ 废纸箱堆放 ⑨ 大声喧哗 ⑩ 货架弯曲

```
Wide-angle eye-level photograph inside the same modern Chinese department store,
a checkout counter, large glass windows on the right, tall storage shelving in the
right background, bright even commercial lighting, photorealistic, 16:9. Staff wear
matching navy blue vests over white shirts. People are spread far apart across the
frame and do not overlap each other.

In the centre-left a staff member sits flat on the floor sorting stock, legs
stretched out, not squatting. On the lower left a big pile of flattened waste
cardboard boxes and packaging paper is dumped beside the walkway. On the right a
large glass window is covered with obvious streaks, drips and water stains running
down it. In the lower centre a staff member is talking with his mouth wide open
very loudly while nearby customers frown and cover their ears. On the lower right
a tall shelf is packed full of boxes, its shelf board visibly bending downward with
several boxes protruding past the edge.

The walls and shelves are completely blank without any text, letters, logos or
signage. Correct human anatomy, normal hands and feet, no extra fingers or limbs.
```

### 图E · 出入口与休息角

对应题库：① 着便装 ② 戴大耳机 ③ 翘腿站立 ④ 背靠货架 ⑤ 未送别顾客 ⑥ 频繁看表 ⑦ 台上私人物品 ⑧ 通道积水 ⑨ 上班睡觉 ⑩ 指示灯不亮

```
Wide-angle eye-level photograph inside the same modern Chinese department store
near the main entrance, a checkout counter and a quiet corner with a desk, bright
even commercial lighting, photorealistic, 16:9. Staff wear matching navy blue vests
over white shirts. People are spread far apart across the frame and do not overlap
each other.

In the centre a staff member slouches with his whole back against a shelf, sliding
down it. On the lower left the checkout counter is cluttered with personal items:
a personal water bottle, a smartphone, a makeup pouch and a snack bag. In the lower
centre a large conspicuous puddle of water lies on the walkway floor with clear
reflections. On the right, in the corner beside a desk, a staff member is fast
asleep slumped over the desk with his eyes closed and his head on his arms. On the
lower right a green exit light box hangs crooked on the wall, its casing cracked
and the light completely off.

The walls and shelves are completely blank without any text, letters, logos or
signage. Correct human anatomy, normal hands and feet, no extra fingers or limbs.
```

### 通用负面提示词（SDXL 用；Flux 系列没有负面框，忽略即可）

```
text, watermark, signature, logo, chinese characters, letters, signage,
distorted face, extra limbs, extra fingers, malformed hands, blurry,
low resolution, overlapping people, cropped bodies, dark lighting,
motion blur, cartoon, anime, illustration, 3d render
```

---

## 四、阶段二：补违规的编辑指令（英文）

把阶段一的图 Load 进 Kontext / Qwen-Edit 工作流，**一次喂一组**，出图后把结果重新 Load 再喂下一组。

### 图A

**Round 2**
```
Add three details to this image: in the centre-right, a staff member standing with
both hands deep in his trouser pockets; in the upper right, a customer just walking
in through the entrance looking confused while a nearby staff member wearing
headphones keeps his back to the door, head down reading a stock list, not turning
around; on the right, one shelf board covered with a thick visible layer of grey
dust. Make all three clearly visible and large. Keep everything else in the image
completely unchanged.
```

**Round 3**
```
Modify only the female cashier on the left side of this image: give her a very long
thick fringe that completely covers her eyes, and remove the name badge from her
chest so the vest is plain and empty there. All the other staff must keep their
visible name badges on the left chest. Keep everything else in the image completely
unchanged.
```

### 图B

**Round 2**
```
Add three details to this image: in the centre-left, a staff member standing with
arms tightly folded across his chest; in the centre-right, a customer reaching out
to ask a question while the staff member has his back fully turned, sorting clothes
on a rack; in the upper left, a male staff member whose white shirt hem hangs loose
and untucked over his trousers. Make all three clearly visible and large. Keep
everything else in the image completely unchanged.
```

**Round 3**
```
Add two details to this image: in the centre-left area, a female staff member
wearing a very thick chunky gold chain necklace and huge oversized hoop earrings,
clearly oversized and obvious; in the lower left, a garment hanging on a rack whose
price tag is torn, curled and dirty, with the tag drawn large and close to the
camera. Keep everything else in the image completely unchanged.
```

### 图C

**Round 2**
```
Add three details to this image: in the centre-right, a female staff member
frowning and rolling her eyes while raising a hand in an impatient gesture toward a
customer, the customer stepping back in surprise, no speech bubbles; in the upper
right, a customer walking away hugging a pile of loose unbagged products in both
arms while a thick stack of unused shopping bags sits untouched on the counter; in
the lower left, a large mirror covered with obvious handprints, water stains and
greasy smudges. Make all three clearly visible and large. Keep everything else in
the image completely unchanged.
```

**Round 3**
```
Modify only the two female staff members on the left side of this image: give the
upper one extremely bright garish neon red lipstick, obviously excessive; give the
one below her long hair hanging completely loose and untied over her shoulders,
while every other female staff member in the image has neatly tied hair in a bun or
ponytail. Keep everything else in the image completely unchanged.
```

### 图D

**Round 2**
```
Add three details to this image: in the centre-right, a cashier handing over a
stack of banknotes one-handed while staring blankly into the distance, not looking
at the money at all, a customer reaching out to take it; in the upper right, a
customer holding up a product and complaining emotionally while the staff member
stands expressionless with arms crossed and eyes wandering away; in the centre, a
staff member serving a customer with one hand in his trouser pocket while gesturing
with the other. Make all three clearly visible and large. Keep everything else in
the image completely unchanged.
```

**Round 3**
```
Modify only the two staff members on the left side of this image: give the upper
one casual house slippers on his feet with his insteps exposed, in obvious contrast
to his neat uniform; move the lower one's name badge from his chest to his belt at
the waist, while every other staff member keeps their badge neatly on the left
chest. Keep everything else in the image completely unchanged.
```

### 图E

**Round 2**
```
Add three details to this image: in the upper left, a staff member wearing casual
jeans and a hoodie while every colleague around him wears the matching navy vest
uniform, strong contrast; in the upper right, a customer seen from behind carrying
shopping bags walking out through the main door while the cashier is already
looking down at her phone and does not see the customer off; in the centre-left, a
staff member standing with one leg crossed over the other, weight shifted awkwardly.
Make all three clearly visible and large. Keep everything else in the image
completely unchanged.
```

**Round 3**
```
Add two details to this image: in the centre-left area, a staff member wearing
large over-ear headphones while handing something to a customer; in the
centre-right, a staff member talking to a customer while raising his wrist to check
his watch, his eyes fixed on the watch face. Keep everything else in the image
completely unchanged.
```

---

## 五、救急话术（英文）

| 问题 | 指令 |
|---|---|
| 某处太小看不清 | `Make the pile of paper scraps on the floor much larger and more obvious. Keep everything else in the image completely unchanged.` |
| 两处挨太近 | `Move the staff member looking at his phone further to the left, away from the person next to him. Keep everything else in the image completely unchanged.` |
| 特征缝到一个人身上 | `The hands-in-pockets pose and the looking-at-phone pose must belong to two different staff members standing apart from each other. Keep everything else in the image completely unchanged.` |
| 出现乱码文字 | `Remove all text, letters and signage from the image, leave the walls and shelves completely blank. Keep everything else in the image completely unchanged.` |
| 手脚畸形 | `Redraw the staff member on the left with correct human anatomy, normal hands and feet. Keep everything else in the image completely unchanged.` |
| 多画了违规 | `Remove the puddle of water in the middle of the floor, that area should be clean dry floor. Keep everything else in the image completely unchanged.` |

---

## 六、指令式编辑搞不定时的兜底

某一处反复画不对（**最容易出问题的是姿势类**：单腿倚柱、趴收银台、坐地整货、翘腿），
再切到蒙版重绘：

### 用 `Flux.1 Dev OneReward`（模板库里标「图像修复/外绘」那个）

1. `Load Image` → 右键 → **Open in MaskEditor**，把要改的区域涂上
2. 提示词只写这一处，短句即可，别写整段场景

| 参数 | 值 |
|---|---|
| Denoise | **0.75 ~ 0.95**（姿势类要高，彻底洗掉原肢体） |
| Mask blur / grow | 8 ~ 16 px |
| 蒙版范围 | **把人物周围的空气、背后的货架一起涂进去**，给新姿势留空间 |

> 蒙版舍不得涂大 = 白重绘。原肢体像素残留会画出三只手。

### 小细节（工牌、口红、刘海）必装这个插件

搜索安装 **`ComfyUI-Inpaint-CropAndStitch`**。

它的作用等同于 WebUI 的「仅蒙版」：**把蒙版区域裁出来放大成高清单独重绘，再无缝贴回**。
不用它的话，几十像素的工牌会被画成一团彩色马赛克。

节点接法：`Inpaint Crop` → 采样 → `Inpaint Stitch`，中间夹你的重绘流程。

### 姿势实在不行 → ControlNet OpenPose

只有在上面都失败时才上，配置成本较高：
`Load ControlNet` → `Apply ControlNet`，配 OpenPose 骨架图，权重 0.8 ~ 1.0。

---

## 七、和 Gemini 版的三个差异（重要）

| | Gemini | ComfyUI Cloud |
|---|---|---|
| 语言 | 中文直接用 | **只认英文**（Qwen-Image-Edit 除外） |
| 安全审查 | 严格，「消防通道被堵」「电源线裸露」会被拒 | **宽松，可以用回原文**，本文档已用回准确描述 |
| 风格一致 | 只能靠对话语义，格局会变 | **可固定 Seed**，同一场景微调能复现 |

**注意**：`识图找茬_Gemini出图提示词.md` 里那份「安全审查平替表」在 ComfyUI 上**不需要**，
本文档已改用更准确的原文描述（blocking the passage / cable lies loose / bending downward…）。

---

## 八、出图后必做

1. **逐条核对 10 处** —— 对着每张图开头的编号清单数
2. **缩小检查** —— 缩到约 965px 宽，每一处还能看出来才合格
3. **检查间距** —— 大屏圆圈直径约 40~64px，**任意两处间距 > 画面宽度的 8%**，否则圆圈会叠住
4. **导出 PNG** —— 命名 `图A.png` ~ `图E.png`，放进项目 `images/` 目录
   （或用 设置 → ④识图找茬 → 场景图 → [上传]）
5. **标坐标** —— 设置 → ④识图找茬 → 场景图 → **[标注找茬点]**：左边选一条 → 右边点位置 →
   自动跳下一条 → 连点 10 下，标满显示「已标注 10/10 处」
6. **试一次** —— 开第四环节勾几处，看大屏绿圈位置对不对

---

## 九、注意

- **题库内容未做任何改动**，所有提示词按现有 50 条违规逐条写
- 「没做某事」类的（图A⑥ 未问候、图D⑤ 找零未点清、图E⑤ 未送别）都给了具体视觉理由
  （戴耳机低头看货单 / 直勾勾盯着别处 / 低头玩手机），赛场上不易起争议
- 某处反复画不出来就接受它的画法，赛前跟评委口头说明如何认定即可
- 5 张图在系统里**随机分给 5 支队伍**，质量要齐平
- `图A.png` 目前仍是测试图，务必替换
