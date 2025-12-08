#!/bin/bash

# 将所有 .js 文件转为 UTF-8（如果不是 UTF-8），并备份原文件为 .bak

echo "?? 扫描并转换非 UTF-8 的 JS 文件为 UTF-8 编码..."

find . -type f -name "*.js" | while read -r file; do
  # 检测文件编码
  encoding=$(file -bi "$file" | sed -n 's/.*charset=//p')

  if [[ "$encoding" != "utf-8" && "$encoding" != "us-ascii" ]]; then
    echo "?? 转换文件: $file (原编码: $encoding)"
    cp "$file" "$file.bak"
    iconv -f "$encoding" -t utf-8 "$file" -o "$file.utf8" && mv "$file.utf8" "$file"
  else
    echo "? 跳过: $file (已是 UTF-8)"
  fi
done

echo "? 所有转换完成（原文件备份为 *.bak）"
