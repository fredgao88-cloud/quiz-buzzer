# -*- coding: utf-8 -*-
"""
新题库解析器 v2 —— 「确定版7.1」docx → JSON

只解析【能可靠机器解析】的三类：单选 / 多选 / 判断。
填空题（单填/多填）因数字答案与下一题题号连写而存在真歧义
（如「答案：452.商厦…」无法判定是 45+2. 还是 452），
本脚本【不碰】，等干净源文件另行处理。见 README 或开发文档 2.2。

用法：
    python parse_qbank_v2.py            # 生成 qbank_v2_staging.json + 校验报告
    python parse_qbank_v2.py --merge    # 与现有 questions.json 的 R4/R5 合并

设计要点：
  · 题号完全不可信（原档有丢号、跳号、重号），一律按【答案标记】切题并重新编号
  · 选项有两种格式混用：「A 文本 B 文本」和「A.文本B.文本」，靠顺序定位 A→B→C→D
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw_qbank_v2.txt"
OUT = HERE / "qbank_v2_staging.json"

SEP = "\x00SEP\x00"


# ── 分节 ────────────────────────────────────────────
def split_sections(raw: str) -> dict[str, str]:
    def cut(a, b):
        i, j = raw.find(a), raw.find(b)
        if i < 0 or j < 0:
            sys.exit(f"找不到分节标记: {a!r} 或 {b!r}")
        return raw[i:j]
    return {
        "single": cut("一、单项选择题", "多项选择题"),
        "multi":  cut("多项选择题", "三、单项填空题"),
        "judge":  cut("五、判断题", "共计"),
    }


# ── 选项解析（兼容两种格式）────────────────────────
def find_options(body: str):
    """
    在 body 中按 A→B→C→D(→E) 的【顺序】定位选项标记，返回 (stem, options)。
    只认「前面不是字母/数字」的孤立大写字母，避免把正文里的字母误当标记。
    找不到完整的 A~D 就返回 (None, None)，交由调用方报错——绝不猜。
    """
    letters = ["A", "B", "C", "D", "E"]
    pos = []
    start = 0
    for L in letters:
        m = re.search(rf"(?<![A-Za-z0-9])({L})\s*[.．、]?\s*", body[start:])
        if not m:
            break
        p = start + m.start()
        pos.append((L, p, start + m.end()))
        start = start + m.end()
    if len(pos) < 4:
        return None, None

    stem = body[: pos[0][1]].strip()
    opts = []
    for i, (L, p, e) in enumerate(pos):
        end = pos[i + 1][1] if i + 1 < len(pos) else len(body)
        opts.append(body[e:end].strip(" 　.．、"))
    if not all(opts):
        return None, None
    return stem, opts


def clean_stem(s: str) -> str:
    s = re.sub(r"^\s*(?:一、单项选择题|多项选择题|五、判断题)\s*", "", s)
    s = re.sub(r"^\s*\d{1,3}\s*[、.．]\s*", "", s)      # 去掉原题号（不可信）
    s = re.sub(r"\s+", " ", s)
    return s.strip()


# ── 各题型解析 ──────────────────────────────────────
def parse_choice(sec: str, kind: str):
    """kind: 'single' | 'multi'"""
    ans_pat = r"答案[：:]\s*([A-D])(?![A-E])" if kind == "single" else r"答案[：:]\s*([A-E]{2,})"
    # 在每个答案标记【之后】切开 —— 题号不可信，答案标记才是题的终点
    t = re.sub(rf"({ans_pat})", r"\1" + SEP, sec)
    out, errs = [], []
    for chunk in (c.strip() for c in t.split(SEP)):
        if not chunk:
            continue
        m = re.search(ans_pat, chunk)
        if not m:
            if re.search(r"[一-龥]", chunk):
                errs.append(("无答案", chunk[:70]))
            continue
        answer = m.group(1)
        body = chunk[: m.start()]
        body = re.sub(r"答案[：:]\s*$", "", body).strip()
        stem, opts = find_options(body)
        if not stem or not opts:
            errs.append(("选项解析失败", chunk[:70]))
            continue
        stem = clean_stem(stem)
        if not stem:
            errs.append(("题干为空", chunk[:70]))
            continue
        # 答案字母必须落在选项范围内
        valid = set("ABCDE"[: len(opts)])
        if not set(answer) <= valid:
            errs.append((f"答案{answer}超出{len(opts)}个选项范围", stem[:50]))
            continue
        out.append({
            "type": kind,
            "stem": stem,
            "options": opts,
            "answer": answer if kind == "single" else sorted(set(answer)),
        })
    return out, errs


def parse_judge(sec: str):
    t = re.sub(r"(（\s*[√×]\s*）)", r"\1" + SEP, sec)
    out, errs = [], []
    for chunk in (c.strip() for c in t.split(SEP)):
        if not chunk:
            continue
        m = re.search(r"（\s*([√×])\s*）", chunk)
        if not m:
            if re.search(r"[一-龥]", chunk):
                errs.append(("无答案", chunk[:70]))
            continue
        stem = clean_stem(chunk[: m.start()])
        if not stem:
            errs.append(("题干为空", chunk[:70]))
            continue
        out.append({"type": "judge", "stem": stem, "answer": m.group(1)})
    return out, errs


# ── 主流程 ──────────────────────────────────────────
def build_questions(single, multi, judge, old_path: Path):
    """
    与现有 questions.json 合并，产出完整题库。

    新题库覆盖：单选 / 多选 / 判断
    沿用旧题库：填空(fill) / 多填(fill_multi) —— 新档存在解析歧义，等干净源文件
                找茬(spot) / 令题(theme)     —— 新档完全没有这两类

    环节映射沿用既有方案（见开发文档 4.x）：
      R1 = 前 40 道单选           （4人×2题×5队 = 40）
      R2 = 2 道多选 + 2 道多填     （单题 5 分 × 4 题）
      R3 = 其余单选 + 其余多选 + 全部填空 + 全部判断
      R4 = 5 张找茬图  R5 = 3 道令题
    """
    old = json.loads(old_path.read_text(encoding="utf-8"))["questions"]
    pick = lambda r, t: [q for q in old if q["round"] == r and q["type"] == t]

    old_fill       = pick(3, "fill")
    old_fill_multi = pick(2, "fill_multi")
    old_spot       = pick(4, "spot")
    old_theme      = pick(5, "theme")
    if not (old_spot and old_theme):
        sys.exit("旧题库里找不到 R4 spot 或 R5 theme，中止（不能产出缺环节的题库）")

    out = []
    # ── R1：前 40 道单选 ──
    for i, q in enumerate(single[:40], 1):
        out.append({"id": f"r1_{i:03d}", "round": 1, "type": "single",
                    "stem": q["stem"], "options": q["options"], "answer": q["answer"],
                    "score_correct": 2.5})
    # ── R2：2 多选 + 2 多填 ──
    for i, q in enumerate(multi[:2], 1):
        out.append({"id": f"r2_mc_{i:03d}", "round": 2, "type": "multi",
                    "stem": q["stem"], "options": q["options"], "answer": q["answer"],
                    "score_correct": 5})
    for i, q in enumerate(old_fill_multi[:2], 1):
        q = dict(q); q["id"] = f"r2_mf_{i:03d}"
        out.append(q)
    # ── R3：其余全部 ──
    for i, q in enumerate(single[40:], 1):
        out.append({"id": f"r3_sc_{i:03d}", "round": 3, "type": "single",
                    "stem": q["stem"], "options": q["options"], "answer": q["answer"],
                    "score_correct": 2, "score_wrong": -2})
    for i, q in enumerate(multi[2:], 1):
        out.append({"id": f"r3_mc_{i:03d}", "round": 3, "type": "multi",
                    "stem": q["stem"], "options": q["options"], "answer": q["answer"],
                    "score_correct": 2, "score_wrong": -2})
    for i, q in enumerate(old_fill, 1):
        q = dict(q); q["id"] = f"r3_f_{i:03d}"
        out.append(q)
    for i, q in enumerate(judge, 1):
        out.append({"id": f"r3_tf_{i:03d}", "round": 3, "type": "judge",
                    "stem": q["stem"], "answer": q["answer"],
                    "score_correct": 2, "score_wrong": -2})
    # ── R4 / R5：原样保留 ──
    out.extend(dict(q) for q in old_spot)
    out.extend(dict(q) for q in old_theme)
    return out


def validate(qs):
    """产出前的硬校验，任何一条不过就中止。"""
    errs = []
    ids = [q["id"] for q in qs]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        errs.append(f"id 重复: {sorted(dup)[:6]}")
    for q in qs:
        if not q.get("stem"):
            errs.append(f'{q["id"]} 题干为空')
        if q["type"] in ("single", "multi"):
            opts = q.get("options") or []
            if len(opts) < 2:
                errs.append(f'{q["id"]} 选项不足')
            valid = set("ABCDE"[: len(opts)])
            ans = q["answer"] if isinstance(q["answer"], list) else [q["answer"]]
            if not set(ans) <= valid:
                errs.append(f'{q["id"]} 答案 {ans} 超出 {len(opts)} 个选项')
        if q["type"] == "judge" and q["answer"] not in ("√", "×"):
            errs.append(f'{q["id"]} 判断答案异常: {q["answer"]!r}')
        if q["type"] == "spot" and not q.get("spots"):
            errs.append(f'{q["id"]} 找茬点为空')
        if q["type"] == "theme" and not q.get("answerPool"):
            errs.append(f'{q["id"]} 令题答案池为空')
    # 赛制要求
    n = lambda r: sum(1 for q in qs if q["round"] == r)
    if n(1) != 40: errs.append(f"R1 应为 40 道，实为 {n(1)}")
    if n(2) != 4:  errs.append(f"R2 应为 4 道，实为 {n(2)}")
    if n(4) != 5:  errs.append(f"R4 应为 5 张图，实为 {n(4)}")
    if n(5) < 3:   errs.append(f"R5 令题不足 3 道，实为 {n(5)}")
    return errs


def main():
    if not RAW.exists():
        sys.exit(f"缺少 {RAW.name}，请先从 docx 导出")
    raw = RAW.read_text(encoding="utf-8")
    secs = split_sections(raw)

    single, e1 = parse_choice(secs["single"], "single")
    multi,  e2 = parse_choice(secs["multi"], "multi")
    judge,  e3 = parse_judge(secs["judge"])
    errs = [("单选",) + e for e in e1] + [("多选",) + e for e in e2] + [("判断",) + e for e in e3]

    # 重复题干检测（原档多选 60/61 号有重号，但内容不同；这里查真正的内容重复）
    dups = []
    seen = {}
    for kind, lst in (("单选", single), ("多选", multi), ("判断", judge)):
        for q in lst:
            key = re.sub(r"\s|[（）()]", "", q["stem"])
            if key in seen:
                dups.append((kind, q["stem"][:52]))
            seen[key] = True

    print("=" * 68)
    print("解析结果")
    print("=" * 68)
    print(f"  单选 {len(single):>3} 道")
    print(f"  多选 {len(multi):>3} 道")
    print(f"  判断 {len(judge):>3} 道")
    print(f"  ---- {len(single)+len(multi)+len(judge):>3} 道（本脚本不含填空题）")
    print()
    print(f"解析错误: {len(errs)}")
    for e in errs[:15]:
        print("   !!", " | ".join(str(x) for x in e))
    print()
    print(f"题干内容重复: {len(dups)}")
    for k, s in dups[:10]:
        print(f"   ~ {k}: {s}")

    OUT.write_text(json.dumps(
        {"single": single, "multi": multi, "judge": judge},
        ensure_ascii=False, indent=1), encoding="utf-8")
    print()
    print(f"已写 {OUT.name}（中间产物）")

    if "--merge" not in sys.argv:
        print("（加 --merge 可合并 R4/R5 与旧填空题，产出 questions.json）")
        return len(errs)

    if errs:
        sys.exit("\n解析有错误，拒绝合并。")

    qpath = HERE / "questions.json"
    qs = build_questions(single, multi, judge, qpath)
    verrs = validate(qs)
    print()
    print("=" * 68)
    print("合并结果")
    print("=" * 68)
    import collections
    c = collections.Counter((q["round"], q["type"]) for q in qs)
    for k in sorted(c):
        print(f"  round {k[0]}  {k[1]:<11} {c[k]:>3}")
    print(f"  {'合计':<20} {len(qs):>3}")
    print()
    if verrs:
        print("校验失败:")
        for e in verrs:
            print("   !!", e)
        sys.exit("\n拒绝写出 questions.json。")
    print("校验通过：0 错误")

    # 备份后写出
    bak = HERE / "questions.backup.json"
    if qpath.exists() and not bak.exists():
        bak.write_text(qpath.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"已备份原题库 → {bak.name}")
    qpath.write_text(json.dumps({"questions": qs}, ensure_ascii=False, indent=1),
                     encoding="utf-8")
    print(f"已写 {qpath.name}（{len(qs)} 道）")
    return 0


if __name__ == "__main__":
    sys.exit(1 if main() else 0)
