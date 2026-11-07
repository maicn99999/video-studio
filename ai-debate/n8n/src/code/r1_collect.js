const state = JSON.parse(JSON.stringify($('Vòng 1: Soạn đề bài').first().json.state));
const res = byRole(assertOk($input.all().map((i) => i.json), 'Vòng 1'));
if (!res.A || !res.B) throw new Error('Vòng 1: thiếu kết quả của một bên');
state.rounds['1'] = { A: res.A.text, B: res.B.text };
state.calls.push(callSummary(res.A), callSummary(res.B));
return [{ json: { state } }];
