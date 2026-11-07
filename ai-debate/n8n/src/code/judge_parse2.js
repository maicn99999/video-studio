const prev = $('Trọng tài: Đọc phán quyết').first().json;
const state = JSON.parse(JSON.stringify(prev.state));
const r = assertOk([$input.first().json], 'Trọng tài (sửa JSON)')[0];
state.calls.push(callSummary(r));
const parsed = normalizeJudge(extractJson(r.text), state.input.criteria);
if (parsed.valid) return [{ json: { state, judgeRaw: r.text, valid: true, problems: [], judge: parsed.judge } }];
// Vẫn chưa hợp lệ: dùng phần đọc được tốt nhất, báo cáo sẽ hiển thị cảnh báo.
return [{ json: { state, judgeRaw: prev.judgeRaw, valid: false, problems: parsed.problems, judge: parsed.judge || prev.judge || null } }];
