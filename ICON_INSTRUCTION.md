# アイコン作成手順

このプロジェクトでは以下のアイコンファイルが必要です：

1. `icon.png` - 基本アイコン
2. `icon-48.png` - 48x48ピクセルアイコン
3. `icon-96.png` - 96x96ピクセルアイコン

これらのファイルは、`icon.svg`ファイルから生成できます。

## アイコン生成方法

### 方法1: オンラインコンバーター

1. `icon.svg`ファイルをダウンロード
2. オンラインSVG→PNGコンバーター（[例: SVG2PNG](https://svgtopng.com/)）にアップロード
3. 必要なサイズに変換
4. 変換されたPNGファイルをダウンロードし、適切な名前で保存

### 方法2: Inkscapeを使用

1. `icon.svg`ファイルをInkscapeで開く
2. 「ファイル」→「ビットマップとしてエクスポート」を選択
3. ダイアログで、幅と高さを設定（48x48と96x96）
4. 「エクスポート」をクリックして、適切な名前で保存

### 方法3: ImageMagickを使用

コマンドラインから次のコマンドを実行：

```bash
# icon.pngを作成（96x96サイズ）
convert -background none icon.svg icon.png

# icon-48.pngを作成
convert -background none -resize 48x48 icon.svg icon-48.png

# icon-96.pngを作成
convert -background none -resize 96x96 icon.svg icon-96.png
```

## 注意点

- PNG形式のアイコンは背景が透明であることを確認してください
- アイコンは正方形であることを確認してください
- SVGからの変換時に品質が低下しないように注意してください

これらのアイコンを作成したら、このファイル（ICON_INSTRUCTION.md）は削除しても構いません。
