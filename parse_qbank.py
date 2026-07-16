# -*- coding: utf-8 -*-
import json, re, sys

# ============================================================
# Step 1: Read raw_qbank.txt
# ============================================================
with open('C:/Users/admin/Desktop/quiz_buzzer/raw_qbank.txt', encoding='utf-8') as f:
    lines = f.readlines()

paragraphs = []
for line in lines:
    line = line.strip()
    m = re.match(r'\d+\t[PT]\|(.+)', line)
    if m:
        paragraphs.append(m.group(1))

full_text = ' '.join(paragraphs)

# ============================================================
# Step 2: Helper functions
# ============================================================
def find_nth(s, sub, n):
    idx = -1
    for _ in range(n):
        idx = s.find(sub, idx + 1)
        if idx == -1:
            return -1
    return idx

SEP = '\x00|||SEP|||\x00'

def inject_seps_sc(text):
    """Insert separator after each single-choice answer followed by next question number."""
    return re.sub(r'(答案[：:]\s*[A-D])(?=\d{1,2}[、.])', r'\1' + SEP, text)

def inject_seps_mc(text):
    """Insert separator after each multi-choice answer followed by next question number."""
    return re.sub(r'(答案[：:]\s*[A-E]{2,})(?=\d{1,2}[、.])', r'\1' + SEP, text)

def parse_opts(opts_str):
    """Parse 'A text B text C text D text [E text]' into list of plain text (no letter prefix)."""
    parts = re.split(r'\s+(?=[A-E]\s)', opts_str)
    result = []
    for part in parts:
        m = re.match(r'^([A-E])\s+(.+)', part.strip(), re.DOTALL)
        if m:
            result.append(m.group(2).strip())  # store text only, no "A. " prefix
    return result if len(result) >= 4 else None

def parse_single_choice(text):
    text2 = inject_seps_sc(text)
    results = []
    for seg in text2.split(SEP):
        seg = seg.strip()
        if not seg:
            continue
        m = re.match(
            r'^(\d{1,2})[、.]\s*(.*?[（(][）)])\s*'
            r'(.+?)\s*答案[：:]\s*([A-D])(?!\s*[A-D])',
            seg, re.DOTALL)
        if not m:
            continue
        num = int(m.group(1))
        stem = m.group(2).strip()
        opts_str = m.group(3).strip()
        answer = m.group(4)
        options = parse_opts(opts_str)
        if not options:
            continue
        results.append({'num': num, 'stem': stem, 'options': options, 'answer': answer})
    seen = set()
    deduped = []
    for q in sorted(results, key=lambda x: x['num']):
        if q['stem'] not in seen:
            seen.add(q['stem'])
            deduped.append(q)
    return deduped

def parse_multi_choice(text):
    text2 = inject_seps_mc(text)
    results = []
    for seg in text2.split(SEP):
        seg = seg.strip()
        if not seg:
            continue
        m = re.match(
            r'^(\d{1,2})[、.]\s*(.*?[（(][）)])\s*'
            r'(.+?)\s*答案[：:]\s*([A-E]{2,})',
            seg, re.DOTALL)
        if not m:
            continue
        num = int(m.group(1))
        stem = m.group(2).strip()
        opts_str = m.group(3).strip()
        answer = list(m.group(4))
        options = parse_opts(opts_str)
        if not options:
            continue
        results.append({'num': num, 'stem': stem, 'options': options, 'answer': answer})
    seen = set()
    deduped = []
    for q in sorted(results, key=lambda x: x['num']):
        if q['stem'] not in seen:
            seen.add(q['stem'])
            deduped.append(q)
    return deduped

def parse_true_false(text):
    results = []
    for m in re.finditer(r'(\d+)[.、]\s*(.{5,}?)[（(]([√×])[）)]', text):
        num = int(m.group(1))
        stem = m.group(2).strip().rstrip('。')
        answer = m.group(3)
        results.append({'num': num, 'stem': stem, 'answer': answer})
    seen = set()
    deduped = []
    for q in sorted(results, key=lambda x: x['num']):
        if q['stem'] not in seen:
            seen.add(q['stem'])
            deduped.append(q)
    return deduped

def parse_unnumbered_tf(lines_list):
    """Parse unnumbered true/false lines like: stem。（√）"""
    results = []
    for line in lines_list:
        m = re.match(r'(.{5,}?)[（(]([√×])[）)]', line.strip())
        if m:
            stem = m.group(1).strip().rstrip('。')
            answer = m.group(2)
            results.append({'stem': stem, 'answer': answer})
    return results

# ============================================================
# Step 3: Find section boundaries and parse
# ============================================================
sc_start = full_text.find('单项选择题')
mc_start = full_text.find('多项选择题')
sf2_start = find_nth(full_text, '单项填空题', 2)
mf2_start = find_nth(full_text, '多项填空题', 2)
tf2_start = find_nth(full_text, '判断题', 2)

sc_block = full_text[sc_start:mc_start]
mc_block = full_text[mc_start:sf2_start if sf2_start > 0 else mf2_start]
tf_block = full_text[tf2_start:] if tf2_start > 0 else full_text[full_text.find('判断题'):]

sc_qs = parse_single_choice(sc_block)
mc_qs = parse_multi_choice(mc_block)
tf_qs = parse_true_false(tf_block)

print(f'Parsed: SC={len(sc_qs)}, MC={len(mc_qs)}, TF={len(tf_qs)}')

# ============================================================
# Step 4: Hardcoded single fill (68 questions)
# ============================================================
fill1_qs = [
    ("指引顾客手势右手并拢，掌心向上，与地面呈____度。", "45"),
    ("商厦经营服务理念：诚信为商、品牌时尚、大众消费、____。", "购物无忧"),
    ("退换货疑难问题统一不出____办公室。", "客服"),
    ("举报私自加价变价经查实，奖励____元。", "500"),
    ("员工跨楼层调动需____楼层经理签字。", "双方"),
    ("晚间玻璃保洁最早开始时间____点。", "18"),
    ("单个烟蒂责任人月度考核扣____分。", "0.5"),
    ("新员工培训费标准为____元。", "100"),
    ("过季特价商品最长销售周期____个月。", "2"),
    ("闭店第一遍送宾铃声时间____。", "19:25"),
    ("员工上下班仅限走____步行通道。", "员工"),
    ("质量问题商品退货执行____退款。", "全额"),
    ("厂商便装私下议价，按标价____倍加收费用。", "3"),
    ("库房垛与货品垛之间安全距离____米。", "1"),
    ("金银、箱包可享受商场免费____服务。", "清洗护理"),
    ("线上下单可享受同城____配送服务。", "免费"),
    ("消防监控室值班最低在岗____人。", "2"),
    ("高空作业需在____部门备案。", "物业安全部"),
    ("扶梯突发事故第一时间按下____按钮。", "急停"),
    ("促销花车摆放需经____审批。", "楼层经理"),
    ("顾客投诉处理完毕需开展电话____工作。", "回访"),
    ("三无商品指无厂址、无合格证、无____。", "商标"),
    ("临时促销员上岗必须佩戴____。", "工牌"),
    ("试衣间内禁止堆放各类____。", "杂物"),
    ("员工水杯需收纳在视线____区域。", "以外"),
    ("超范围经营商品起步罚款____元。", "5000"),
    ("散装食品必须配备防尘____。", "遮盖"),
    ("客诉无法现场解决引导至楼层____。", "办公室"),
    ("员工档案统一由____部门归档。", "综合部"),
    ("动火现场必须配备足量____器材。", "灭火"),
    ("卖场发现危化品第一时间上报____。", "物业安全部"),
    ("私自改动专柜布局罚款____元起。", "500"),
    ("会员单次消费满____元可办理会员卡。", "200"),
    ("消防卷帘下方严禁堆放____。", "货品"),
    ("导购禁止私下合并顾客____。", "积分"),
    ("品牌授权到期最长预留____个月清货期。", "3"),
    ("新品牌进场提前至少____天申报。", "14"),
    ("晚间垃圾统一收纳至指定____点位。", "垃圾"),
    ("女员工在岗允许发色为黑色与____。", "棕色"),
    ("男员工鬓角不得超过耳朵____。", "中线"),
    ("食品岗禁止佩戴____饰品。", "戒指"),
    ("正面表彰员工可全商厦____。", "通报表彰"),
    ("出现火情优先引导顾客____。", "疏散"),
    ("闭店清场顺序从五层至____逐层离场。", "一层"),
    ("商场劝阻吸烟标准话术：本商场是____商场。", "无烟"),
    ("荣资商厦企业使命：致力于满足____老百姓个性化品质生活。", "包头"),
    ("商厦企业愿景：打造包头老百姓____体验式休闲购物新天地。", "时尚化"),
    ("商厦服务宗旨：顾客至上，____，一切以顾客满意为标准。", "用心服务"),
    ("商厦三大发展方向：品牌化、年轻化、____。", "时尚化"),
    ("发生电器火灾，扑救前必须先切断____。", "电源"),
    ("消防栓周边____米范围内禁止堆放任何物品。", "1"),
    ("库房内禁止使用____瓦以上白炽灯照明。", "60"),
    ("电气设备使用原则：人走____。", "断电"),
    ("商场突发火灾，人员疏散优先走____通道。", "消防疏散"),
    ("私拉乱接电线属于____和用电双重违规。", "消防"),
    ("顾客微信、支付宝付款手续费扣点标准为千分之____。", "三"),
    ("营业员离职满____个月，方可申请退还岗位管理费。", "一"),
    ("商户固定结算打款时间为每周____。", "二"),
    # Additional simple fill (lines 35-44)
    ("顾客投诉处理的原则是先______，后处理。", "安抚"),
    ("营业员介绍商品应做到真实、准确、______。", "客观"),
    ("会员管理工作的核心是提升会员______。", "忠诚度"),
    ("顾客满意是服务工作的最终______。", "目标"),
    ("营业员应熟练掌握商品知识和______知识。", "售后"),
    ("优质服务从顾客进店开始，到顾客______结束。", "满意离店"),
    ("团队协作的重要基础是相互______。", "配合"),
    ("直播销售过程中必须坚持诚信______。", "经营"),
    ("服务创新的核心是提升顾客______。", "体验"),
    ("营业员应做到主动服务、热情服务和______服务。", "规范"),
]

# ============================================================
# Step 5: Hardcoded multi-fill for Round 2 (2 questions)
# ============================================================
fill2_r2 = [
    {
        "stem": "退换货三不出：不出货柜、___、___。",
        "blanks": [
            {"hint": "第1空", "answer": ["不出卖场"]},
            {"hint": "第2空", "answer": ["不出库房"]},
        ]
    },
    {
        "stem": "卖场四洁标准：商品洁净、___、___、设施洁净。",
        "blanks": [
            {"hint": "第1空", "answer": ["墙面立柱洁净"]},
            {"hint": "第2空", "answer": ["柜台柜体洁净"]},
        ]
    },
]

# ============================================================
# Step 6: Hardcoded Round 4 (spot) and Round 5 (theme)
# ============================================================
r4_spots = [
    {"id": "r4_img_A", "round": 4, "type": "spot", "imageKey": "图A",
     "stem": "场景图A：综合服务违规找茬",
     "spots": [
         {"key":"a1","label":"仪容：员工刘海遮眼"},
         {"key":"a2","label":"仪容：未佩戴工牌"},
         {"key":"b1","label":"站姿：倚靠收银台"},
         {"key":"b2","label":"站姿：双手插兜"},
         {"key":"c1","label":"服务：接待顾客时看手机"},
         {"key":"c2","label":"服务：未主动问候进店顾客"},
         {"key":"d1","label":"卫生：地面有纸屑"},
         {"key":"d2","label":"卫生：货架积灰明显"},
         {"key":"e1","label":"纪律：员工卖场内进食"},
         {"key":"e2","label":"安全：消防通道被箱子堵塞"}
     ], "score_correct": 1},
    {"id": "r4_img_B", "round": 4, "type": "spot", "imageKey": "图B",
     "stem": "场景图B：综合服务违规找茬",
     "spots": [
         {"key":"a1","label":"仪容：着装不整，衬衫未扎"},
         {"key":"a2","label":"仪容：佩戴过多饰品"},
         {"key":"b1","label":"站姿：交叉抱臂站立"},
         {"key":"b2","label":"站姿：坐在货柜上"},
         {"key":"c1","label":"服务：顾客询问时背对顾客"},
         {"key":"c2","label":"服务：两员工聊天忽视顾客"},
         {"key":"d1","label":"卫生：试衣间地面脏乱"},
         {"key":"d2","label":"卫生：商品标签破损未处理"},
         {"key":"e1","label":"纪律：私自离岗"},
         {"key":"e2","label":"安全：电源线裸露在地面"}
     ], "score_correct": 1},
    {"id": "r4_img_C", "round": 4, "type": "spot", "imageKey": "图C",
     "stem": "场景图C：综合服务违规找茬",
     "spots": [
         {"key":"a1","label":"仪容：口红颜色过于夸张"},
         {"key":"a2","label":"仪容：头发披肩未束起"},
         {"key":"b1","label":"站姿：单腿倚靠立柱"},
         {"key":"b2","label":"站姿：趴在收银台上"},
         {"key":"c1","label":"服务：使用不文明用语"},
         {"key":"c2","label":"服务：未给顾客打包装袋"},
         {"key":"d1","label":"卫生：货架陈列杂乱"},
         {"key":"d2","label":"卫生：镜面有明显污迹"},
         {"key":"e1","label":"纪律：员工互相打闹"},
         {"key":"e2","label":"安全：灭火器被遮挡"}
     ], "score_correct": 1},
    {"id": "r4_img_D", "round": 4, "type": "spot", "imageKey": "图D",
     "stem": "场景图D：综合服务违规找茬",
     "spots": [
         {"key":"a1","label":"仪容：未化淡妆（规定需化妆）"},
         {"key":"a2","label":"仪容：工牌贴错位置"},
         {"key":"b1","label":"站姿：蹲坐在地上整货"},
         {"key":"b2","label":"站姿：手放在兜里接待顾客"},
         {"key":"c1","label":"服务：找零未当面点清"},
         {"key":"c2","label":"服务：对顾客投诉态度冷漠"},
         {"key":"d1","label":"卫生：窗户玻璃有水渍"},
         {"key":"d2","label":"卫生：废纸箱堆放在卖场"},
         {"key":"e1","label":"纪律：员工卖场内大声喧哗"},
         {"key":"e2","label":"安全：高处货架超载"}
     ], "score_correct": 1},
    {"id": "r4_img_E", "round": 4, "type": "spot", "imageKey": "图E",
     "stem": "场景图E：综合服务违规找茬",
     "spots": [
         {"key":"a1","label":"仪容：员工着便装上班"},
         {"key":"a2","label":"仪容：指甲过长且有彩绘"},
         {"key":"b1","label":"站姿：翘腿站立"},
         {"key":"b2","label":"站姿：背靠货架滑动"},
         {"key":"c1","label":"服务：顾客离去未送别"},
         {"key":"c2","label":"服务：接待时频繁看时间"},
         {"key":"d1","label":"卫生：收银台摆放私人物品"},
         {"key":"d2","label":"卫生：卖场通道有积水"},
         {"key":"e1","label":"纪律：上班时间睡觉"},
         {"key":"e2","label":"安全：安全出口指示灯损坏"}
     ], "score_correct": 1},
]

r5_themes = [
    {"id": "r5_theme_001", "round": 5, "type": "theme",
     "stem": "服务规范用语",
     "answerPool": ["欢迎光临", "您好请问有什么可以帮您", "请稍等", "感谢您的耐心等待",
                    "非常抱歉给您带来不便", "感谢您的光临", "欢迎下次再来",
                    "请问您需要帮助吗", "这款商品非常适合您", "请随意参观",
                    "有什么问题请随时告诉我", "非常感谢您的建议",
                    "请问您是需要退换货吗", "好的我马上为您处理", "请慢走",
                    "感谢您选择我们", "祝您购物愉快", "您的会员积分已累计",
                    "请出示您的会员卡"]},
    {"id": "r5_theme_002", "round": 5, "type": "theme",
     "stem": "商场经营管理制度",
     "answerPool": ["明码标价谢绝议价", "退换货三不出", "员工在岗三大禁止",
                    "首问负责制", "卖场四洁四无", "品牌授权管理",
                    "消防四个能力", "全域禁烟制度", "动火三不动火原则",
                    "临时用电审批制度", "三无商品下架处理", "举报奖励制度",
                    "私收货款违规处罚", "员工交接班制度", "残次商品管理规定"]},
    {"id": "r5_theme_003", "round": 5, "type": "theme",
     "stem": "荣资商厦企业文化",
     "answerPool": ["诚信为商", "品牌时尚", "大众消费", "购物无忧",
                    "顾客至上", "用心服务", "品牌化", "年轻化", "时尚化",
                    "合作", "发展", "创新", "共赢",
                    "致力于满足包头老百姓个性化品质生活",
                    "打造包头老百姓时尚化体验式休闲购物新天地"]},
]

# ============================================================
# Step 7: Build questions JSON
# ============================================================
questions = []

# Round 1: first 40 single choice
for i, q in enumerate(sc_qs[:40]):
    questions.append({
        "id": f"r1_{i+1:03d}",
        "round": 1,
        "type": "single",
        "stem": q['stem'],
        "options": q['options'],
        "answer": q['answer'],
        "score_correct": 2.5,
    })

# Round 2: 2 multi choice + 2 multi fill
for i, q in enumerate(mc_qs[:2]):
    questions.append({
        "id": f"r2_mc_{i+1:03d}",
        "round": 2,
        "type": "multi",
        "stem": q['stem'],
        "options": q['options'],
        "answer": q['answer'],
        "score_correct": 5,
    })
for i, q in enumerate(fill2_r2):
    questions.append({
        "id": f"r2_mf_{i+1:03d}",
        "round": 2,
        "type": "fill_multi",
        "stem": q['stem'],
        "blanks": q['blanks'],
        "score_correct": 5,
    })

# Round 3: remaining single choice
for i, q in enumerate(sc_qs[40:]):
    questions.append({
        "id": f"r3_sc_{i+1:03d}",
        "round": 3,
        "type": "single",
        "stem": q['stem'],
        "options": q['options'],
        "answer": q['answer'],
        "score_correct": 2,
        "score_wrong": -2,
    })

# Round 3: remaining multi choice (skip first 2)
for i, q in enumerate(mc_qs[2:]):
    questions.append({
        "id": f"r3_mc_{i+1:03d}",
        "round": 3,
        "type": "multi",
        "stem": q['stem'],
        "options": q['options'],
        "answer": q['answer'],
        "score_correct": 2,
        "score_wrong": -2,
    })

# Round 3: all single fill
for i, (stem, ans) in enumerate(fill1_qs):
    questions.append({
        "id": f"r3_f_{i+1:03d}",
        "round": 3,
        "type": "fill",
        "stem": stem,
        "answer": ans,
        "score_correct": 2,
        "score_wrong": -2,
    })

# Round 3: all true/false (judge)
for i, q in enumerate(tf_qs):
    questions.append({
        "id": f"r3_tf_{i+1:03d}",
        "round": 3,
        "type": "judge",
        "stem": q['stem'],
        "answer": q['answer'],
        "score_correct": 2,
        "score_wrong": -2,
    })

# Round 4 and 5
questions.extend(r4_spots)
questions.extend(r5_themes)

# ============================================================
# Step 8: Write output
# ============================================================
output = {"questions": questions}
out_path = 'C:/Users/admin/Desktop/quiz_buzzer/questions.json'
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

# Summary
r1 = [q for q in questions if q['round'] == 1]
r2 = [q for q in questions if q['round'] == 2]
r3 = [q for q in questions if q['round'] == 3]
r4 = [q for q in questions if q['round'] == 4]
r5 = [q for q in questions if q['round'] == 5]
r3_types = {}
for q in r3:
    r3_types[q['type']] = r3_types.get(q['type'], 0) + 1

print(f'\n=== questions.json generated: {out_path} ===')
print(f'R1 single choice : {len(r1)}')
print(f'R2 questions     : {len(r2)} ({[q["type"] for q in r2]})')
print(f'R3 buzzer        : {len(r3)} {r3_types}')
print(f'R4 spot          : {len(r4)}')
print(f'R5 theme         : {len(r5)}')
print(f'TOTAL            : {len(questions)}')
