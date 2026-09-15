# Quick Download / Compact UI 設計

## 目的

共有ページでの通常操作を「現在の共有を全部保存する」に最適化し、初期画面のボタン数を減らす。

通常ユーザーの最短経路は次の1操作とする。

```text
共有ページを開く
  -> 「すべてダウンロード」
  -> 必要なら保存先のブラウザ許可
  -> 共有解析
  -> Full Queue作成
  -> COPY -> ownership confirm -> DOWNLOAD -> VERIFY -> owned destId DELETE
```

既存の安全トランザクション、lease、ownership proof、LOCAL_COMMITTED、DELETE guardは変更しない。

## UX方針

### 共有ページの初期画面

初期状態で見せる主操作は原則2つだけ。

1. **すべてダウンロード** — 現在開いている共有を必要なら自動解析し、Full Queueを開始する。
2. **ファイルを選ぶ** — 共有を必要なら解析し、選択UIを展開する。

署名テスト、診断ログ、状態再表示、容量スキップ再試行、Queue安全破棄、保存先変更、手動再解析などは `詳細` に格納する。

Queue実行中/停止中は、通常の開始操作よりQueue継続操作を優先表示する。

- 実行中: `現在ファイル後に停止`
- PAUSED/未完了: `Queueを再開`
- retry/abandon等: `詳細`

### disk.linkex.io

後方互換のため手動共有URL入力を残す。ただし解析専用ボタンは主画面から外し、`すべてダウンロード` / `ファイルを選ぶ` が必要に応じて解析する。

## ワンクリックの定義

### 初回

ブラウザのFile System Access APIは、未選択の保存先をスクリプトが勝手に決めることを許さない。そのため最初の1回だけ、`すべてダウンロード` を押した直後に `showDirectoryPicker()` が開く。

アプリ内では追加の「解析」「開始」「確認」クリックを要求しない。

### 2回目以降

選択済みbase directoryの `FileSystemDirectoryHandle` を既存IndexedDB `handles` storeへ保存する。

- key: `preferred-download-root:v1`
- 保存内容: DirectoryHandleのみ
- path文字列やファイル内容は保存しない
- Queue固有handle (`queue-full:<jobId>`) とは別管理

起動時にhandleとpermission stateを先読みする。権限が `granted` の場合、`すべてダウンロード` は保存先ダイアログなしで共有解析からQueue開始まで進む。

permissionが `prompt` の場合は同じボタンクリックのuser gesture内で `requestPermission({mode:'readwrite'})` を行う。`denied` / handleなしの場合は同じuser gesture内で `showDirectoryPicker()` を呼ぶ。

## user-gesture制約

`showDirectoryPicker()` はtransient user activationを要求するため、ネットワーク解析やIndexedDB読み取りを待った後に呼ばない。

そのためpreferred DirectoryHandleはパネル起動時に非同期で先読みし、クリック時には次の順序を守る。

```text
click
  -> 認証/Queue同期チェック（同期処理）
  -> cached preferred handleに対するpermission request または showDirectoryPicker
  -> ここから先で初めて共有API解析
  -> Queue作成/開始
```

この順序は回帰テストで固定する。

## 自動解析

`ensureManifestForCurrentShare()` 相当の共通処理を用意し、以下から共有する。

- `すべてダウンロード`
- `ファイルを選ぶ`
- 詳細内の `再解析`

共有ページでは解析開始時tokenと解析完了時の現在tokenを照合し、ページ遷移があった場合はmanifestを採用しない。

Full Queue開始直前にも既存のshare-token再照合を維持する。

## 確認ダイアログ

Quick Downloadでは開始確認ダイアログを出さない。

理由:

- ユーザーが明示的に `すべてダウンロード` を押している。
- 元共有ファイルや既存own fileは削除しない。
- DELETE対象は既存どおりDownloader自身が作成したと証明済み一時copy 1件のみ。

選択ダウンロードは `選択をダウンロード` という明示ボタンから開始するため、同様に追加confirmを不要とする方向とする。

`Queueを安全に破棄` は状態消去操作なので従来の確認ダイアログを維持する。

## UI構成

概略:

```text
┌ Linkex Downloader                         − ┐
│ このページの共有: ... / 認証 ... / 保存先 ... │
│                                             │
│ [          すべてダウンロード          ]   │
│ [            ファイルを選ぶ             ]   │
│                                             │
│ （選択モード時だけファイル一覧）             │
│                                             │
│ （Queueがある時だけ Resume / Stop）          │
│ progress                                    │
│ 状態: 現在処理を1行表示                     │
│                                             │
│ ▸ 詳細                                      │
└─────────────────────────────────────────────┘
```

`詳細` 内:

- 保存先を変更
- 共有を再解析
- 署名テスト
- 診断ログを保存
- 状態を再表示
- 容量スキップを再試行
- Queueを安全に破棄
- ログを表示（通常は折りたたみ。エラー時は自動展開）

詳細ログは初期画面に常時表示せず、通常時は進捗バーと1行の状態表示だけを見せる。処理履歴自体は従来どおり保持し、診断ログJSON出力にも含める。

有効でない操作はdisabled/hiddenにする。

## 保存先表示

DirectoryHandleの `name` のみUIに表示してよい。フルローカルパスはブラウザAPIから通常取得できず、取得・保存もしない。

例:

```text
保存先: Downloads
```

未設定の場合:

```text
保存先: 未設定（初回に選択）
```

## 既存Queueとの関係

preferred handleは「新しいQueueのbase directory候補」にのみ使う。

未完了Queueのresumeでは従来どおり `queue-full:<jobId>` のQueue固有handleを使う。preferred handleへフォールバックしてresume先を勝手に変えない。

これは途中再開時のローカルpath不変条件を維持するため。

## ページ遷移

共有Aのmanifestがある状態で共有Bへ遷移した場合、従来どおりAのmanifestを無効化する。

preferred保存先は共有に依存しないため維持する。

Queue実行中のページ遷移でも、実行中QueueのshareToken / queueRootは変更しない。

## エラー時

- auth bridgeなし: Queueを作らず案内表示
- 保存先pickerキャンセル: 何も開始しない
- permission denied: Queueを作らず案内表示
- manifest解析失敗: Queueを作らない
- 未完了Queueあり: 新Queueを作らない
- share URL変化: stale manifestで開始しない

既存のfail-closed方針を維持する。

## テスト

追加する構造/回帰テスト:

1. 初期UIのprimary操作が `すべてダウンロード` / `ファイルを選ぶ` 中心になっている。
2. 診断/破棄/再試行系が `details` 内に移動している。
3. preferred DirectoryHandle keyがQueue handleと分離されている。
4. Quick Downloadのclick pathでdirectory permission/pickerがmanifest network解析より先に行われる。
5. Quick Downloadが追加confirmなしでFull Queueを開始する。
6. 選択パネルはmanifest作成だけでは自動展開されず、選択モード時だけ展開される。
7. resumeがpreferred handleへフォールバックせず既存Queue handleだけを使う。
8. 詳細ログが初期画面では折りたたまれ、1行状態表示が常時見え、エラー時だけログが自動展開される。
9. COPY -> DOWNLOAD -> DELETE安全中核の既存テストは全件維持する。

## リリース方針

Quick Download / compact UI / collapsed verbose logはv1.2.0 release candidateへ含める。`linkex-downloader.user.js` を正本とし、version固定 `.user.js` / `.zip` はrelease対象commitから `tools/build_release_assets.py` で生成してGitHub Releaseにだけ添付する。リポジトリ直下へ固定配布物を蓄積しない。
