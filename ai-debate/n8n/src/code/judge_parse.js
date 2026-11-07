const state = JSON.parse(JSON.stringify($('Trọng tài: Soạn hồ sơ').first().json.state));
const r = assertOk([$input.first().json], 'Trọng tài')[0];
state.calls.push(callSummary(r));
const parsed = normalizeJudge(extractJson(r.text), state.input.criteria);
return [{ json: { state, judgeRaw: r.text, valid: parsed.valid, problems: parsed.problems, judge: parsed.judge || null } }];
