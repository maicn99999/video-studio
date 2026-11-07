// Vòng 2: mỗi AI đọc phương án của đối phương và phản biện chi tiết.
const state = $input.first().json.state;
return ['A', 'B'].map((side) => {
  const other = OTHER[side];
  const prompt = `${problemBlock(state.input)}
---
## PHƯƠNG ÁN VÒNG 1 CỦA BẠN (Bên ${side})
${clip(state.rounds['1'][side])}

---
## PHƯƠNG ÁN VÒNG 1 CỦA ĐỐI PHƯƠNG (Bên ${other})
${clip(state.rounds['1'][other])}

---
## NHIỆM VỤ — VÒNG 2: PHẢN BIỆN CHI TIẾT
Hãy phản biện phương án của Bên ${other} một cách công bằng và sắc bén. Trình bày theo cấu trúc:
## 1. Điểm mạnh của phương án đối phương (công nhận trung thực)
## 2. Điểm yếu, lỗ hổng lập luận, giả định sai hoặc thiếu căn cứ
## 3. Rủi ro đối phương bỏ sót hoặc đánh giá thấp
## 4. Câu hỏi chất vấn (đánh số)
## 5. Những điểm hai bên đồng thuận
## 6. Điều bạn rút ra và dự định điều chỉnh trong phương án của mình`;
  return { json: { state, ...llmRequest(state, { round: 2, role: side, stage: 'critique', system: debaterSystem(side, state.participants[side].label), prompt }) } };
});
