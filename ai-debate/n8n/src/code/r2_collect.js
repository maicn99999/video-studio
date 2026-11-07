const state = JSON.parse(JSON.stringify($('Vòng 2: Soạn đề bài phản biện').first().json.state));
const res = byRole(assertOk($input.all().map((i) => i.json), 'Vòng 2'));
if (!res.A || !res.B) throw new Error('Vòng 2: thiếu kết quả của một bên');
state.rounds['2'] = { A: res.A.text, B: res.B.text };
state.calls.push(callSummary(res.A), callSummary(res.B));
return [{ json: { state } }];
