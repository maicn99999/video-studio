const state = JSON.parse(JSON.stringify($('Vòng 3: Soạn đề bài hoàn thiện').first().json.state));
const res = byRole(assertOk($input.all().map((i) => i.json), 'Vòng 3'));
if (!res.A || !res.B) throw new Error('Vòng 3: thiếu kết quả của một bên');
state.rounds['3'] = { A: res.A.text, B: res.B.text };
state.calls.push(callSummary(res.A), callSummary(res.B));
return [{ json: { state } }];
