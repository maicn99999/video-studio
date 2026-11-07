// Phán quyết chưa đúng định dạng: yêu cầu trọng tài sửa lại JSON (1 lần).
const prev = $input.first().json;
const state = prev.state;
const system = 'Bạn là trợ lý chuẩn hóa dữ liệu. Chỉ trả về MỘT JSON object hợp lệ, không thêm chữ nào khác, không dùng ```.';
const prompt = `Văn bản dưới đây là phán quyết của trọng tài nhưng chưa phải JSON hợp lệ theo schema yêu cầu.
Các vấn đề phát hiện: ${(prev.problems || []).join('; ') || 'không đọc được JSON'}.

Tên tiêu chí chính xác: ${state.input.criteria.map((c) => `"${c.name}"`).join(', ')}.

Hãy chuyển nó thành JSON đúng schema, GIỮ NGUYÊN nội dung đánh giá và điểm số; chỉ bổ sung trường thiếu khi suy ra được từ văn bản.

SCHEMA:
${JUDGE_SCHEMA_HINT}

VĂN BẢN GỐC:
${clip(prev.judgeRaw, 40000)}`;
return [{ json: { state, ...llmRequest(state, { round: 5, role: 'judge', stage: 'judge', system, prompt }) } }];
