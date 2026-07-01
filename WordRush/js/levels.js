export const LEVELS = [
  { id: "elementary3", label: "小学校3年", file: "data/elementary3.csv", targetWords: 150, baseSpeed: 40, accel: 0.66, bonus: 0 },
  { id: "elementary4", label: "小学校4年", file: "data/elementary4.csv", targetWords: 150, baseSpeed: 42, accel: 0.7, bonus: 2 },
  { id: "elementary5", label: "小学校5年", file: "data/elementary5.csv", targetWords: 200, baseSpeed: 44, accel: 0.74, bonus: 4 },
  { id: "elementary6", label: "小学校6年", file: "data/elementary6.csv", targetWords: 200, baseSpeed: 46, accel: 0.78, bonus: 6 },
  { id: "junior1-part1", label: "中学校1年 Part1", file: "data/junior1-part1.csv", targetWords: 200, baseSpeed: 48, accel: 0.84, bonus: 8 },
  { id: "junior1-part2", label: "中学校1年 Part2", file: "data/junior1-part2.csv", targetWords: 200, baseSpeed: 50, accel: 0.88, bonus: 10 },
  { id: "junior1-part3", label: "中学校1年 Part3", file: "data/junior1-part3.csv", targetWords: 200, baseSpeed: 52, accel: 0.92, bonus: 12 },
  { id: "junior2-part1", label: "中学校2年 Part1", file: "data/junior2-part1.csv", targetWords: 200, baseSpeed: 54, accel: 0.98, bonus: 16 },
  { id: "junior2-part2", label: "中学校2年 Part2", file: "data/junior2-part2.csv", targetWords: 200, baseSpeed: 56, accel: 1.02, bonus: 18 },
  { id: "junior2-part3", label: "中学校2年 Part3", file: "data/junior2-part3.csv", targetWords: 200, baseSpeed: 58, accel: 1.06, bonus: 20 },
  { id: "junior3-part1", label: "中学校3年 Part1", file: "data/junior3-part1.csv", targetWords: 200, baseSpeed: 60, accel: 1.12, bonus: 24 },
  { id: "junior3-part2", label: "中学校3年 Part2", file: "data/junior3-part2.csv", targetWords: 200, baseSpeed: 62, accel: 1.16, bonus: 26 },
  { id: "junior3-part3", label: "中学校3年 Part3", file: "data/junior3-part3.csv", targetWords: 200, baseSpeed: 64, accel: 1.2, bonus: 28 },
  { id: "high1-part1", label: "高校1年 Part1", file: "data/high1-part1.csv", targetWords: 210, baseSpeed: 66, accel: 1.26, bonus: 34 },
  { id: "high1-part2", label: "高校1年 Part2", file: "data/high1-part2.csv", targetWords: 210, baseSpeed: 68, accel: 1.3, bonus: 36 },
  { id: "high1-part3", label: "高校1年 Part3", file: "data/high1-part3.csv", targetWords: 210, baseSpeed: 70, accel: 1.34, bonus: 38 },
  { id: "high1-part4", label: "高校1年 Part4", file: "data/high1-part4.csv", targetWords: 210, baseSpeed: 72, accel: 1.38, bonus: 40 },
  { id: "high2-part1", label: "高校2年 Part1", file: "data/high2-part1.csv", targetWords: 210, baseSpeed: 74, accel: 1.44, bonus: 46 },
  { id: "high2-part2", label: "高校2年 Part2", file: "data/high2-part2.csv", targetWords: 210, baseSpeed: 76, accel: 1.48, bonus: 48 },
  { id: "high2-part3", label: "高校2年 Part3", file: "data/high2-part3.csv", targetWords: 210, baseSpeed: 78, accel: 1.52, bonus: 50 },
  { id: "high2-part4", label: "高校2年 Part4", file: "data/high2-part4.csv", targetWords: 210, baseSpeed: 80, accel: 1.56, bonus: 52 },
  { id: "high3-part1", label: "高校3年 Part1", file: "data/high3-part1.csv", targetWords: 210, baseSpeed: 82, accel: 1.62, bonus: 60 },
  { id: "high3-part2", label: "高校3年 Part2", file: "data/high3-part2.csv", targetWords: 210, baseSpeed: 84, accel: 1.66, bonus: 62 },
  { id: "high3-part3", label: "高校3年 Part3", file: "data/high3-part3.csv", targetWords: 210, baseSpeed: 86, accel: 1.7, bonus: 64 },
  { id: "high3-part4", label: "高校3年 Part4", file: "data/high3-part4.csv", targetWords: 210, baseSpeed: 88, accel: 1.74, bonus: 66 }
];

export const LEVEL_MAP = new Map(LEVELS.map((level) => [level.id, level]));
