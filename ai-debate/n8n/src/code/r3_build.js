// Vòng 3: mỗi AI hoàn thiện phương án sau khi nhận phản biện.
const state = $input.first().json.state;
return ['A', 'B'].map((side) => {
  const other = OTHER[side];
  const prompt = `${problemBlock(state.input)}
---
## PHƯƠNG ÁN VÒNG 1 CỦA BẠN (Bên ${side})
${clip(state.rounds['1'][side])}

---
## PHẢN BIỆN CỦA ĐỐI PHƯƠNG (Bên ${other}) DÀNH CHO BẠN
${clip(state.rounds['2'][other])}

---
## PHẢN BIỆN BẠN ĐÃ VIẾT VỀ PHƯƠNG ÁN ĐỐI PHƯƠNG
${clip(state.rounds['2'][side], 12000)}

---
## NHIỆM VỤ — VÒNG 3: HOÀN THIỆN PHƯƠNG ÁN
Tiếp thu phản biện hợp lý, bác bỏ phản biện sai (có lý do), và đưa ra phương án CUỐI CÙNG tốt nhất. Có thể tiếp nhận ý hay của đối phương. Trình bày theo cấu trúc:
## 1. Những thay đổi so với Vòng 1 và lý do
## 2. Phản hồi từng phản biện chính (Chấp nhận / Bác bỏ — vì sao)
## 3. Phương án cuối cùng (chi tiết, các bước cụ thể)
## 4. Rủi ro còn lại & biện pháp giảm thiểu
## 5. Kế hoạch hành động (bảng: Bước | Việc cần làm | Thời hạn | KPI)
## 6. Bất đồng còn lại với đối phương (nếu có)`;
  return { json: { state, ...llmRequest(state, { round: 3, role: side, stage: 'refine', system: debaterSystem(side, state.participants[side].label), prompt }) } };
});
