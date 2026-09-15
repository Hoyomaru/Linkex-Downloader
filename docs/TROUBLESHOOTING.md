# Linkex Downloader — トラブルシューティング

この文書は、Linkex Downloader 利用時の代表的な問題を **症状 → 原因候補 → 対処** の順で整理したものです。

安全のため、COPY/DELETE結果が曖昧な状態を「とりあえず再実行」で解消しようとしないでください。未完了Queueがある場合は、まず **Queueを再開** で実状態照合を行います。

## まず確認すること

問題が起きたら次を確認してください。

1. `https://disk.linkex.io/` にログインしているか
2. Tampermonkeyで Linkex Downloader が有効か
3. 右下のパネルが表示されているか
4. **署名テスト** がPASSするか
5. **状態を再表示** で未完了Queueがないか
6. 必要に応じて **診断ログを保存** してJSONを確認する

診断ログはtoken・署名付きURLなどを伏せて出力する設計ですが、外部へ共有する前には念のため内容を確認してください。

## パネルが表示されない

**症状**

`disk.linkex.io` を開いても右下に Linkex Downloader が出ない。

**原因候補**

- Tampermonkeyでuserscriptが無効
- userscriptのインストール失敗
- 実行対象URLが `https://disk.linkex.io/*` ではない
- JavaScript構文エラー
- Linkexページ側の大きな変更

**対処**

- Tampermonkey管理画面でスクリプトが有効か確認する
- `linkex-downloader.user.js` をもう一度保存する
- `https://disk.linkex.io/` を再読み込みする
- DevTools Console に `[Linkex ...]` 由来のエラーがないか確認する

## 「Linkexログイン情報を検出できません」

**症状**

共有解析はできるが、Queue開始/再開時にログイン情報を検出できない。

**原因候補**

- Linkexへ未ログイン
- ログイン状態が期限切れ
- Linkex Web側のLocal Storage構造変更

**対処**

1. `disk.linkex.io` で一度ログアウト/ログイン状態を確認する
2. Linkex画面を再読み込みする
3. **署名テスト** を実行する
4. 改善しない場合は診断ログを保存し、開発者側で credential discovery の互換性を確認する

認証tokenを手作業でコードへ貼り付けないでください。

## 共有ページで「Linkex認証連携: 未準備」になる

**症状**

`https://l2e.click/d/...` 上で共有解析はできるが、Queue開始前に認証連携が未準備と表示される。

**原因**

共有ページと自ストレージページは別originです。Downloaderは安全のため `l2e.click` のLocal Storageをアカウント認証として信用せず、`disk.linkex.io` で検出したaccess tokenだけをTampermonkey GM storage経由で短時間橋渡しします。

**対処**

1. `https://disk.linkex.io/` をログイン済み状態で一度開く
2. 数秒待ってから共有ページへ戻る
3. 共有ページを再フォーカスするか再読み込みする
4. **この共有を解析** → Queue開始を再実行する

bridgeはrefresh tokenを保存せず、最大12時間またはJWT expiryの早い方で失効します。期限切れの場合は同じ手順で再準備してください。

## 「このブラウザでは showDirectoryPicker が利用できません」

**症状**

保存先選択時にFile System Access API関連のエラーが出る。

**原因候補**

- File System Access APIを利用できないブラウザ
- 通常のChrome/Edge以外の環境
- ブラウザ権限/ポリシー

**対処**

ChromeまたはEdgeの通常ウィンドウで試してください。

現行実装は `showDirectoryPicker()` / File System Access API を前提にしています。Firefox等の動作は未確認です。

## 保存先権限がない

**症状**

「保存先ファイルへの書き込み権限がありません」等で停止する。

**原因候補**

- 過去に保存したDirectoryHandleのpermissionが失われた
- ブラウザ再起動後に再許可が必要
- 保存先フォルダが移動/削除された

**対処**

- ブラウザが権限確認を表示した場合は、同じ保存先へのread/writeを許可する
- Handle自体が失われた場合、現在のQueueを安全に再開できない可能性があります
- その場合は既存ローカルファイルとLinkex側一時コピーの状態を確認してから対応してください

**注意:** 未完了Queueがある状態で新しいQueueを重ねて開始しないでください。

## 「別タブでLinkex Downloaderが動作中」

**症状**

Queue開始/再開を拒否される。

**原因候補**

`linkexQueueFullLeaseV1` の有効leaseを別tabが保持しています。

**対処**

- Linkex Downloaderを動かしている別tabを確認する
- 同時に2つのQueueを実行しない
- 片方が安全停止/完了した後に再開する

leaseは同一userscript storage上の多重実行防止です。別端末・別ブラウザプロファイルまで排他できるものではありません。

## 共有リンク解析に失敗する

**症状**

「共有URLの形式が正しくありません」「l2e.click/d/...形式ではありません」等。

**原因候補**

- 対応形式ではないURL
- 共有tokenの誤入力
- 共有期限切れ/無効
- Linkex API仕様変更

**対処**

- `https://l2e.click/d/...` 形式のURLをそのまま入力する
- ブラウザで共有URL自体が開けるか確認する
- 同じ問題が続く場合は署名テストと診断ログを確認する

## 署名テストがFAILする

**症状**

**署名テスト** で既知ベクトルがFAILする。

**原因候補**

- userscriptの署名ロジックが変更された
- MD5/signing key生成が壊れた
- Linkex公式実装の署名仕様が変わった

**対処**

Queueを開始しないでください。

`runSignatureSelfTest()` がPASSしない状態でAPI書き込み処理を試すのは避け、`signRequest()` とLinkex Webの現行実装を再調査してください。

## 容量不足でスキップされる

**症状**

`SKIPPED_CAPACITY` になり、そのファイルだけ処理されず次へ進む。

**原因候補**

Linkex自領域の空き容量が対象ファイルより少ない。

**対処**

- Linkex側の不要な自分のファイルを整理する
- プラン/容量条件を変更する
- Queue完了後に **容量スキップを再試行** を押す
- その後 **Queueを再開** する

安全に事前/サーバー拒否として判定できた項目だけが再試行対象になります。

## `UNFITTABLE` になる

**症状**

特定ファイルが単一ファイル上限としてskipされる。

**原因候補**

- 対象ファイルサイズがLinkexの総容量を超える
- Linkex側が `size_exceeded` を返した

**対処**

現行方式では、そのファイルを自領域へ一時コピーできないため処理できません。

容量条件が変わった場合は「容量スキップを再試行」で再評価できます。

## コピー先IDを一意に確定できない

**症状**

`AMBIGUOUS_COPY` / ownership関連エラーでQueueが停止する。

**原因候補**

コピー開始後に own root file ID が複数増えたため、Downloaderが作ったファイルを証明できない。

典型例:

- Queue実行中に別tabからファイルを追加した
- スマホ/別端末からLinkexへコピーした
- 他の自動処理が同時にLinkexを書き換えた

**対処**

1. Linkex側の直近追加ファイルを手動で確認する
2. どれがDownloaderの一時コピーかを安易に名前だけで決めない
3. Queueをそのまま何度も再開しない
4. 診断ログを保存して状態を保全する

現行実装はこの状態から誤削除を避けるため自動処理を止めます。

## COPY結果不明で停止する

**症状**

`UNCERTAIN_NO_EVIDENCE` / `copy_uncertain` 等で停止する。

**原因候補**

- copy POST中の通信断
- task確認失敗
- API応答不明
- コピー後ファイルを確認できなかった

**対処**

**copyボタンのようなものを手動で再送しないでください。**

現行実装は同じcopy POSTを盲目的に再送せず、own rootの実状態を照合します。証拠が得られない場合は安全停止します。

この状態は診断ログとLinkex側実データを見て個別判断が必要です。

## ダウンロードが途中で止まる

**症状**

`DOWNLOAD_PAUSED`、network/CDNエラー等。

**原因候補**

- ネットワーク切断
- signed CDN URL期限切れ
- CDN一時エラー
- ブラウザ/端末のスリープ

**対処**

- ネットワークを戻す
- **Queueを再開** する

現行実装はローカル既存サイズを利用し、可能な場合はRange requestで続きから取得します。

network/CDN/range系は1回のQueue処理内で最大3回まで再試行します。

## ダウンロード中に403になる

**症状**

CDNがHTTP 403を返す。

**原因候補**

signed URLの期限切れ。

**対処**

通常は実装が同じ `destId` からURLを再取得して再試行します。

繰り返し失敗する場合はLinkex API/CDN仕様変更の可能性があります。診断ログを保存してください。

## Range再開時に200が返る

**症状**

途中ファイルがあるのにCDNが206ではなく200を返す。

**挙動**

現行実装は「Range無視」と判断し、その200 response bodyを0 byteから保存し直します。

これは重複追記による破損を防ぐための安全処理です。

## Range 416で停止する

**症状**

CDNが416を返す。

**原因候補**

ローカルファイルサイズとCDN上の実サイズの関係が不整合。

**挙動/対処**

- ローカルサイズがCDN実サイズと一致 → 完成済みとして扱える
- ローカルサイズがCDN実サイズより大きい → 0 byteから安全にやり直す
- その他の不整合 → 停止

停止した場合はQueue再開前に診断ログを確認してください。

## サイズ検証失敗

**症状**

`VERIFY_FAILED` / 「サイズ検証失敗」。

**原因候補**

- ローカル書き込み不完全
- CDN転送異常
- ブラウザ/ストレージ側の問題

**対処**

Queueを再開して再ダウンロードを試します。

**重要:** この状態では `LOCAL_COMMITTED` ではないため、Linkex側一時コピーは削除されません。

## Linkex metadataのサイズとローカルサイズが違う

**症状**

Linkex上に表示されるsizeと、実際に取得したファイルsizeが一致しない。

**説明**

この差異は実機で確認済みです。

現行実装では:

- Linkex metadata size → copy candidate identity照合
- CDN `Content-Length` / Rangeから得る実サイズ → ローカル完全性検証

と用途を分けています。

metadata sizeに合わせてローカルファイルを切り詰めたりしないでください。

## DELETE結果不明で停止する

**症状**

`DELETE_UNCERTAIN` / `DELETE_UNCERTAIN_PRESENT` で停止する。

**原因候補**

DELETE request送信後に通信が切れ、成功/失敗を確定できない。

**対処**

現行実装は同じDELETEを盲目的に再送しません。

- `destId` が消えている → `DONE` と判断可能
- `destId` が残っている → 安全のため停止

残っている場合は、ownership情報とローカル検証情報を確認せず手動削除しないでください。

## 「削除拒否」が出る

**症状**

`delete_guard` でQueueが停止する。

**原因候補**

次のいずれかの安全条件が満たされていません。

- `LOCAL_COMMITTED` ではない
- `confirmedDest.id` がない
- `destId` がコピー前から存在していた
- ダウンロード対象IDとownership IDが違う
- ローカルサイズ検証未完了
- `verifiedAt` がない
- 削除直前identityが変化した

**対処**

これは誤削除防止のための意図的な停止です。

ガードを無効化して続行せず、診断ログとLinkex上の対象IDを確認してください。

## 「現在ファイル後に停止」を押してもすぐ止まらない

**症状**

停止ボタンを押した後も現在のファイル処理が続く。

**説明**

仕様です。

停止要求は、現在のファイルについて `COPY → DL → VERIFY → DELETE` の安全な処理境界まで進んでから `PAUSED_USER` になります。

途中で強制的に破壊操作の境界を切らないための設計です。

## ページ再読み込み後にQueueが見つかる

**症状**

再読み込みすると「未完了Full Queueを検出しました」と表示される。

**説明**

正常です。Queue状態はGM storageに保存されています。

**対処**

**Queueを再開** を押すと、保存済みtransaction stateとLinkex実状態を照合して続行します。

## 新しい共有を開始できない

**症状**

共有解析はできても「全ファイル開始」が無効。

**原因候補**

未完了Queueが保存されています。

**対処**

- **状態を再表示** で既存Queueを確認
- まず既存Queueを安全に再開/完了させる

未完了状態を無視して新Queueを重ねる設計にはなっていません。

## 診断ログに何が入るか

`linkex-support-YYYYMMDD-HHMMSS.json` には主に次が入ります。

- product/version
- 生成時刻
- 署名セルフテスト結果
- Queue状態
- event log

出力時にtoken/JWT/Authorization/Cookie/signature/signed URL等をredactします。

## 問題報告時にあるとよい情報

秘密情報を除いたうえで、次があると原因を追いやすくなります。

- Linkex Downloader Version
- Chrome/Edgeの種類とVersion
- Tampermonkey Version
- 発生した操作
- UIに表示されたエラーメッセージ
- Queue state / item state
- 署名テスト PASS/FAIL
- 診断ログJSON
- ページ再読み込みで再現するか
- 別tab/別端末で同時にLinkexを操作していたか

共有URLそのものやtoken等を公開Issueへそのまま貼らないでください。

## 未完了Queueを破棄したい

`AMBIGUOUS_COPY` / `UNCERTAIN_NO_EVIDENCE` などで安全停止し、実状態を確認したうえでそのQueueを継続しないと判断した場合は **Queueを安全に破棄** を使用できます。

- Queue/transactionのローカル保存状態だけを消します。
- Linkex APIのDELETEは呼びません。
- ローカルへ保存済みのファイルも削除しません。
- COPY結果が不明なケースではLinkex上に一時コピーが残っている可能性があります。

破棄前に必要なら **診断ログを保存** し、破棄後はLinkex側の直近ファイルを手動確認してください。


## 「すべてダウンロード」で保存先選択が毎回出る

初回はブラウザ仕様上、保存先フォルダを明示的に選ぶ必要があります。Downloaderは選択したDirectoryHandleをIndexedDBへ記憶します。

2回目以降も毎回pickerが出る場合は、サイト/ブラウザのファイルシステム権限が保持されていない、サイトデータが消去された、別origin（`l2e.click` / `www.l2e.click` 等）で開いている、または保存先Handleが無効になった可能性があります。`詳細` → `保存先を変更` から選び直してください。

未完了Queueの再開先はpreferred保存先へ自動変更されません。再開は開始時のQueue固有DirectoryHandleだけを使用します。
