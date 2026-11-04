# oto2tone / oto2score 🎼

スマートフォン（iPhone / Android）対応の、録音から五線譜への自動採譜Webアプリです。

## 機能

- 歌声・ハミング・ピアノ演奏を録音、または音声ファイルを読み込み
- ブラウザ内で音高を解析し、簡易五線譜を表示
- MIDI / MusicXML をダウンロード
- 音符の半音修正・削除・追加
- 7種類の試聴音色: Wurlitzer / Steinway / Yamaha 風の鍵盤3種類、歌声風シンセ4種類
- 母音「あいうえお」を音符に割り当てて歌声風に再生
- サーバーへの録音音声のアップロードなし

> **重要:** 初音ミク・巡音ルカ・鏡音リン・レンの公式音源は含まれません。歌声は母音合成による独自の試作音色です。鍵盤音も公式サンプルではなくブラウザシンセによる近似です。自動採譜精度は実験段階です。

## GitHub Pages で公開する

このリポジトリでは `main` ブランチの最上位に `index.html` を配置済みです。

1. [Settings → Pages](https://github.com/eoumuse/oto2tone/settings/pages) を開く。
2. **Build and deployment → Source** を **Deploy from a branch** にする。
3. **Branch** を `main`、フォルダを `/(root)` にして **Save**。
4. 公開後に `https://eoumuse.github.io/oto2tone/` を開く。
5. iPhoneのSafariなら共有メニューから「ホーム画面に追加」。

マイクを使うには HTTPS が必要です。録音・解析はブラウザ内で行います。Chrome/Safariで音声の再生開始時に利用者のタップが必要です。

## 制限

最大60秒の録音に対応。歌声の単旋律は比較的扱いやすいものの、ピアノの和音、ペダル、残響、速いパッセージの解析は特に誤差が出やすいため、譜面と音符を必ず確認してください。実機iPhoneでの検証は今後必要です。

## Files

- `index.html`: スマホUI
- `app.js`: 録音・譜面表示・MIDI/MusicXML・7音色再生
- `analyzer-worker.js`: 音高検出
- `manifest.webmanifest`: ホーム画面追加用メタデータ
- `sw.js`: オフラインキャッシュ
- `icons/icon.svg`: アイコン
