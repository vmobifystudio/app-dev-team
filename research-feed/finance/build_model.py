#!/usr/bin/env python3
"""Builds finance/research-feed-financials.xlsx with live formulas.
Every assumed number is labelled "assumption" with a way to test it.
Run: python3 finance/build_model.py   (then it recalculates with LibreOffice so values are cached)
NOT FINANCIAL ADVICE. This is a planning sheet.
"""
import os, shutil, subprocess, sys, tempfile
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.formatting.rule import CellIsRule

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "research-feed-financials.xlsx")

H = Font(bold=True, color="FFFFFF"); HF = PatternFill("solid", fgColor="2250D8")
INP = PatternFill("solid", fgColor="FFF4D6"); GIVEN = PatternFill("solid", fgColor="E8F0FF")
B = Font(bold=True)
thin = Side(style="thin", color="CCCCCC")

wb = Workbook()

# ---------------- Assumptions ----------------
A = wb.active; A.title = "Assumptions"
A["A1"] = "Research Feed: financial model"; A["A1"].font = Font(bold=True, size=14)
A["A2"] = "Yellow cells are assumptions you can change. Blue cells are given in the brief. Every assumption has a test. Not financial advice."
A.append([])
A.append(["Item", "Base", "Bear", "Bull", "Status", "How to test it"])
for c in A[4]: c.font = H; c.fill = HF

rows = [
 # key, label, base, bear, bull, status, test, number_format
 ("team",   "Team cost per month ($)", 8000, 8000, 8000, "given", "Payroll and contractor invoices.", "#,##0"),
 ("story",  "Cost to make one story ($)", 0.40, 0.80, 0.30, "assumption", "Sum llm_runs.cost_usd plus editor minutes for the first 40 stories.", "0.00"),
 ("spm",    "Stories published per month", 40, 25, 60, "assumption", "Count weeks 1 to 4 output. Adjust if an editor cannot approve this many.", "0"),
 ("serve",  "Serving cost per reader per month ($)", 0.05, 0.08, 0.04, "assumption", "CDN + hosting bill divided by monthly active readers after week 6.", "0.00"),
 ("price_m","Pro list price per month ($)", 9, 9, 9, "given", "Price page.", "0.00"),
 ("price_a","Pro list price per year ($)", 79, 79, 79, "given", "Price page.", "0.00"),
 ("annual", "Share of Pro users on the annual plan", 0.0, 0.30, 0.0, "assumption", "Split of plan choices in the first 100 sign-ups.", "0%"),
 ("feepct", "Merchant of record fee (percent)", 0.05, 0.05, 0.05, "assumption", "Get a written quote from Paddle or Lemon Squeezy.", "0.0%"),
 ("feefix", "Merchant of record fee (fixed, $ per charge)", 0.50, 0.50, 0.50, "assumption", "Same quote.", "0.00"),
 ("conv",   "Free reader to Pro conversion", 0.04, 0.02, 0.06, "assumption", "Weeks 9 to 12: Pro signups divided by readers who followed a field.", "0.0%"),
 ("r12",    "Free readers per month at month 12", 12500, 6000, 25000, "assumption", "Weekly growth from the 50-reader test in weeks 5 to 8, extended.", "#,##0"),
 ("prompt", "Month the Pro prompt turns on", 3, 4, 3, "assumption", "Launch plan: weeks 9 to 12.", "0"),
 ("sp1",    "First month with sponsored revenue", 4, 6, 4, "assumption", "Pitch log: first signed order date.", "0"),
 ("spn",    "Sponsored stories per month at steady state", 8, 3, 12, "assumption", "Pitches sent vs signed. Needs 20 pitches a month at a 40% close rate for 8.", "0"),
 ("spp",    "Price per sponsored story ($)", 500, 400, 600, "assumption", "Ask 10 labs what they would pay for one story.", "#,##0"),
 ("spr",    "Months to ramp to steady sponsored volume", 6, 6, 6, "assumption", "Compare to pitch cycle length.", "0"),
 ("once",   "One-time costs in month 1: legal review of 4 documents, DMCA agent fee ($)", 3000, 4500, 2500, "assumption", "Get two quotes from lawyers. The DMCA agent fee is $6.", "#,##0"),
 ("cpm",    "Ad revenue per 1,000 views ($)", 2, 2, 2, "assumption", "Only needed to show ads do not work. Test with a 2-week ad trial if you doubt it.", "0.00"),
]
ROW = {}
for i, (k, label, b, r, u, st, test, nf) in enumerate(rows):
    r_i = 5 + i; ROW[k] = r_i
    A.append([label, b, r, u, st, test])
    for col in "BCD":
        A[f"{col}{r_i}"].number_format = nf
        A[f"{col}{r_i}"].fill = GIVEN if st == "given" else INP

n = 5 + len(rows) + 1
A.cell(row=n, column=1, value="Derived").font = B
D = {}
def derived(key, label, fmt):  # formulas per column
    global n
    n += 1; D[key] = n
    A.cell(row=n, column=1, value=label)
    for col in "BCD":
        c = A[f"{col}{n}"]; c.number_format = fmt
    return n
r1 = derived("net_m", "Net per monthly Pro user after fee ($)", "0.00")
r2 = derived("net_a", "Net per annual Pro user, per month ($)", "0.00")
r3 = derived("net", "Blended net per Pro user per month ($)", "0.00")
for col in "BCD":
    A[f"{col}{r1}"] = f"={col}{ROW['price_m']}-({col}{ROW['price_m']}*{col}{ROW['feepct']}+{col}{ROW['feefix']})"
    A[f"{col}{r2}"] = f"=({col}{ROW['price_a']}-({col}{ROW['price_a']}*{col}{ROW['feepct']}+{col}{ROW['feefix']}))/12"
    A[f"{col}{r3}"] = f"=(1-{col}{ROW['annual']})*{col}{r1}+{col}{ROW['annual']}*{col}{r2}"
A.cell(row=r1, column=5, value="computed"); A.cell(row=r1, column=6, value="Brief says $8.05. This must match.")

n += 2
A.cell(row=n, column=1, value="Reader growth curve (share of month-12 readers). assumption: S-curve. Test: compare weekly actuals after week 8.").font = B
curve = [0, 0.004, 0.024, 0.06, 0.12, 0.2, 0.3, 0.42, 0.56, 0.7, 0.85, 1.0]
CURVE0 = n + 1
for m, g in enumerate(curve, 1):
    A.cell(row=CURVE0 + m - 1, column=1, value=f"Month {m}")
    c = A.cell(row=CURVE0 + m - 1, column=2, value=g); c.fill = INP; c.number_format = "0.0%"

A.column_dimensions["A"].width = 62
for col in "BCD": A.column_dimensions[col].width = 12
A.column_dimensions["E"].width = 12; A.column_dimensions["F"].width = 80

# ---------------- Scenario sheets ----------------
def scenario(name, col):
    ws = wb.create_sheet(name)
    ws["A1"] = f"{name} scenario: monthly cash for 12 months"; ws["A1"].font = Font(bold=True, size=13)
    heads = ["Month", "Free readers", "Pro users", "Paid sponsored stories", "Pro revenue", "Sponsored revenue", "Total revenue",
             "Team", "Story costs", "Serving", "One-time", "Total cost", "Net", "Cumulative cash", "Cash need this month", "Break-even flag"]
    ws.append([]); ws.append(heads)
    for c in ws[3]: c.font = H; c.fill = HF; c.alignment = Alignment(wrap_text=True)
    a = lambda k: f"Assumptions!${col}${ROW[k]}"
    for m in range(1, 13):
        r = 3 + m
        ws.cell(row=r, column=1, value=m)
        ws.cell(row=r, column=2, value=f"={a('r12')}*Assumptions!$B${CURVE0 + m - 1}")
        ws.cell(row=r, column=3, value=f"=IF(A{r}>={a('prompt')},B{r}*{a('conv')},0)")
        ws.cell(row=r, column=4, value=f"=IF(A{r}<{a('sp1')},0,MIN({a('spn')},{a('spn')}*(A{r}-{a('sp1')}+1)/{a('spr')}))")
        ws.cell(row=r, column=5, value=f"=C{r}*Assumptions!${col}${D['net']}")
        ws.cell(row=r, column=6, value=f"=D{r}*{a('spp')}")
        ws.cell(row=r, column=7, value=f"=E{r}+F{r}")
        ws.cell(row=r, column=8, value=f"={a('team')}")
        ws.cell(row=r, column=9, value=f"={a('spm')}*{a('story')}")
        ws.cell(row=r, column=10, value=f"=B{r}*{a('serve')}")
        ws.cell(row=r, column=11, value=f"=IF(A{r}=1,{a('once')},0)")
        ws.cell(row=r, column=12, value=f"=SUM(H{r}:K{r})")
        ws.cell(row=r, column=13, value=f"=G{r}-L{r}")
        ws.cell(row=r, column=14, value=f"=M{r}" if m == 1 else f"=N{r-1}+M{r}")
        ws.cell(row=r, column=15, value=f"=MAX(0,-M{r})")
        ws.cell(row=r, column=16, value=f"=IF(M{r}>=0,A{r},99)")
        for c in range(2, 3): ws.cell(row=r, column=c).number_format = "#,##0"
        for c in range(3, 5): ws.cell(row=r, column=c).number_format = "#,##0.0"
        for c in range(5, 16): ws.cell(row=r, column=c).number_format = "#,##0;[Red]-#,##0"
    ws.cell(row=16, column=1, value="Total").font = B
    for c, L in [(7, "G"), (12, "L"), (13, "M"), (15, "O")]:
        ws.cell(row=16, column=c, value=f"=SUM({L}4:{L}15)").number_format = "#,##0;[Red]-#,##0"; ws.cell(row=16, column=c).font = B
    ws.freeze_panes = "B4"
    ws.column_dimensions["A"].width = 8
    for i in range(2, 17): ws.column_dimensions[chr(64 + i)].width = 13
    ws.row_dimensions[3].height = 32
    return ws

for nm, col in [("Base", "B"), ("Bear", "C"), ("Bull", "D")]: scenario(nm, col)

# ---------------- Summary ----------------
S = wb.create_sheet("Summary", 0)
S["A1"] = "Summary: path to breakeven, and what breaks it"; S["A1"].font = Font(bold=True, size=14)
S["A2"] = "All numbers come from the Assumptions sheet. Change a yellow cell there and everything here moves."
S.append([]); S.append(["", "Base", "Bear", "Bull", "Note"])
for c in S[4]: c.font = H; c.fill = HF
sheets = {"B": "Base", "C": "Bear", "D": "Bull"}
srow = {}
def line(key, label, fn, fmt="#,##0", note=""):
    r = S.max_row + 1; srow[key] = r
    S.cell(row=r, column=1, value=label)
    for col, sh in sheets.items():
        c = S[f"{chr(ord(col))}{r}"]; c.value = fn(col, sh); c.number_format = fmt
    S.cell(row=r, column=5, value=note)

a = lambda col, k: f"Assumptions!{col}{ROW[k]}"
line("r12", "Free readers at month 12", lambda c, s: f"={s}!B15")
line("p12", "Pro users at month 12", lambda c, s: f"={s}!C15")
line("s12", "Paid sponsored stories in month 12", lambda c, s: f"={s}!D15", "0.0")
line("rev12", "Revenue in month 12 ($)", lambda c, s: f"={s}!G15", "#,##0;[Red]-#,##0")
line("cost12", "Cost in month 12 ($)", lambda c, s: f"={s}!L15", "#,##0;[Red]-#,##0")
line("net12", "Net in month 12 ($)", lambda c, s: f"={s}!M15", "#,##0;[Red]-#,##0", "Positive means the business pays its bills that month.")
line("peak", "Peak cash you must have funded ($)", lambda c, s: f"=MAX(0,-MIN({s}!N4:N15))", "#,##0", "The most negative cumulative cash. This is the raise-or-savings number.")
line("need", "Sum of monthly cash needs over 12 months ($)", lambda c, s: f"={s}!O16", "#,##0")
line("be_month", "First month with net cash flow at or above 0", lambda c, s: f'=IF(MIN({s}!P4:P15)=99,"not in 12 months",MIN({s}!P4:P15))', "0")
S.append([])
S.cell(row=S.max_row + 1, column=1, value="Breakeven at steady state (monthly)").font = B
fixed = lambda c: f"({a(c,'team')}+{a(c,'spm')}*{a(c,'story')})"
margin = lambda c: f"(Assumptions!{c}{D['net']}-{a(c,'serve')}/{a(c,'conv')})"
line("margin", "Profit per Pro user after serving the readers needed to find them ($)", lambda c, s: f"={margin(c)}", "0.00",
     "Net per Pro user minus serving cost per reader divided by conversion. Base: 8.05 - 0.05/4% = 6.80.")
line("be0", "Pro users needed with NO sponsored stories", lambda c, s: f"=ROUNDUP({fixed(c)}/{margin(c)},0)", "#,##0")
line("be1", "Pro users needed with the steady sponsored volume above", lambda c, s: f"=ROUNDUP(MAX(0,{fixed(c)}-{a(c,'spn')}*{a(c,'spp')})/{margin(c)},0)", "#,##0")
line("ber", "Free readers needed for that many Pro users", lambda c, s: f"=ROUNDUP({c}{srow['be1']}/{a(c,'conv')},0)", "#,##0")
line("bes", "Sponsored stories needed per month at the month-12 Pro count", lambda c, s: f"=ROUNDUP(MAX(0,{fixed(c)}+{s}!B15*{a(c,'serve')}-{s}!C15*Assumptions!{c}{D['net']})/{a(c,'spp')},0)", "0")
S.append([])
S.cell(row=S.max_row + 1, column=1, value="Check of the brief's own math (base assumptions)").font = B
r = S.max_row + 1; S.cell(row=r, column=1, value="500 Pro x $8.05 + 8 sponsored x $500 ($)"); S.cell(row=r, column=2, value=f"=500*Assumptions!B{D['net_m']}+8*Assumptions!B{ROW['spp']}"); S.cell(row=r, column=5, value="Brief: $8,025")
r2_ = r + 1; S.cell(row=r2_, column=1, value="Team cost ($)"); S.cell(row=r2_, column=2, value=f"=Assumptions!B{ROW['team']}"); S.cell(row=r2_, column=5, value="Brief: $8,000")
r3_ = r + 2; S.cell(row=r3_, column=1, value="Serving 12,500 readers ($)"); S.cell(row=r3_, column=2, value=f"=500/Assumptions!B{ROW['conv']}*Assumptions!B{ROW['serve']}"); S.cell(row=r3_, column=5, value="Brief: about $625, but it left this out of the $8,025 vs $8,000 line")
r4_ = r + 3; S.cell(row=r4_, column=1, value="Story costs ($)"); S.cell(row=r4_, column=2, value=f"=Assumptions!B{ROW['spm']}*Assumptions!B{ROW['story']}")
r5_ = r + 4; S.cell(row=r5_, column=1, value="Real monthly result of the brief's target mix ($)").font = B; S.cell(row=r5_, column=2, value=f"=B{r}-B{r2_}-B{r3_}-B{r4_}"); S.cell(row=r5_, column=5, value="Negative: the brief's target mix does not break even once readers cost money. See the breakeven rows above.")
for rr in range(r, r5_ + 1): S.cell(row=rr, column=2).number_format = "#,##0;[Red]-#,##0"
r6_ = r5_ + 2
S.cell(row=r6_, column=1, value="Why ads fail: views per month to cover the team cost"); S.cell(row=r6_, column=2, value=f"=Assumptions!B{ROW['team']}/(Assumptions!B{ROW['cpm']}/1000)"); S.cell(row=r6_, column=2).number_format = "#,##0"; S.cell(row=r6_, column=5, value="Brief: 4,000,000 views at $2 per 1,000. Versus about 590 Pro users.")
S.column_dimensions["A"].width = 66
for col in "BCD": S.column_dimensions[col].width = 16
S.column_dimensions["E"].width = 90

# ---------------- Sensitivity ----------------
T = wb.create_sheet("Sensitivity")
T["A1"] = "What breaks it: monthly net ($) at 12,500 readers, by conversion rate and sponsored stories per month (base costs)"; T["A1"].font = B
T["A2"] = "Green = pays its bills. Red = loses money. Rows: conversion. Columns: paid sponsored stories per month."
T.cell(row=4, column=1, value="Conversion \\ Sponsored").font = B
for j, sp in enumerate(range(0, 13)):
    T.cell(row=4, column=2 + j, value=sp).font = B
for i, cv in enumerate([0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08]):
    r = 5 + i
    c = T.cell(row=r, column=1, value=cv); c.number_format = "0%"; c.font = B
    for j in range(13):
        colL = chr(66 + j)
        T.cell(row=r, column=2 + j, value=(
            f"=Assumptions!$B${ROW['r12']}*$A{r}*Assumptions!$B${D['net']}+{colL}$4*Assumptions!$B${ROW['spp']}"
            f"-Assumptions!$B${ROW['team']}-Assumptions!$B${ROW['spm']}*Assumptions!$B${ROW['story']}"
            f"-Assumptions!$B${ROW['r12']}*Assumptions!$B${ROW['serve']}")).number_format = "#,##0;[Red]-#,##0"
rng = "B5:N11"
T.conditional_formatting.add(rng, CellIsRule(operator="greaterThanOrEqual", formula=["0"], fill=PatternFill("solid", bgColor="C6EFCE", fgColor="C6EFCE")))
T.conditional_formatting.add(rng, CellIsRule(operator="lessThan", formula=["0"], fill=PatternFill("solid", bgColor="FFC7CE", fgColor="FFC7CE")))
T.column_dimensions["A"].width = 24

wb.save(OUT)

# Recalculate with LibreOffice so values are cached for viewers that do not calculate.
soffice = shutil.which("soffice")
if soffice:
    with tempfile.TemporaryDirectory() as d:
        subprocess.run([soffice, "--headless", "--calc", "--convert-to", "xlsx", "--outdir", d, OUT], check=True, capture_output=True, timeout=180)
        shutil.copy(os.path.join(d, os.path.basename(OUT)), OUT)
    print("recalculated with LibreOffice")
print("wrote", OUT)
