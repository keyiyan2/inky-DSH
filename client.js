/**
 * Client half of the Ink writing panel (bundle `@local/dsh-ink`).
 *
 * Registers one rail entry (`sidebar.panellist`) and the panel behind it
 * (`main`, keyed by the same id): an editor for the `.ink` files of the
 * configured Inky project, a composer that builds a syntactically valid line
 * with pickable `#speaker` / `#portrait` / `#layout` tags, and a lint view
 * backed by the real ink compiler on the Host side.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-ink',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useLayoutEffect, useMemo, useRef, useState } = React

    const NS = 'dsh-ink'
    const PANEL_ID = 'dsh-ink'
    const API = '/dsh-ink/api'
    const LAST_FILE_KEY = 'dsh-ink:last-file'
    const CUSTOM_TAGS_KEY = 'dsh-ink:custom-tags'
    const CUSTOM_KEYS_KEY = 'dsh-ink:custom-keys'
    const POLL_MS = 5000
    const NONE = '__none__'
    const EMPTY = '__empty__'
    const DEFAULT_KEYS = ['speaker', 'portrait', 'layout']
    const ZOOM_KEY = 'dsh-ink:zoom'
    const WRAP_KEY = 'dsh-ink:wrap-mode'
    const LEFT_OPEN_KEY = 'dsh-ink:left-open'
    const RIGHT_OPEN_KEY = 'dsh-ink:right-open'
    const LEFT_WIDTH_KEY = 'dsh-ink:left-width'
    const RIGHT_WIDTH_KEY = 'dsh-ink:right-width'
    const PREVIEW_OPEN_KEY = 'dsh-ink:preview-open'
    const LABEL_MODE_KEY = 'dsh-ink:label-mode'
    const RAIL_PLACEMENT_KEY = 'dsh-ink:rail-placement'
    const BAND_TINTS_KEY = 'dsh-ink:band-tints'
    const BAND_STRENGTH_KEY = 'dsh-ink:band-strength'
    const FOLD_HIGHLIGHT_KEY = 'dsh-ink:fold-highlight'
    const SPEAKER_COLORS_KEY = 'dsh-ink:speaker-colors'
    const BUTTON_VISIBILITY_KEY = 'dsh-ink:button-visibility'
    const COMPOSER_PRESETS_KEY = 'dsh-ink:composer-presets'
    const RECENT_FILES_KEY = 'dsh-ink:recent-files'

    const ACTION_BUTTONS = [
      { key: 'filesPanel', labelKey: 'filesPanel' },
      { key: 'composerPanel', labelKey: 'composerPanel' },
      { key: 'dir', labelKey: 'switchDir' },
      { key: 'vocab', labelKey: 'vocab' },
      { key: 'outline', labelKey: 'outline' },
      { key: 'blueprint', labelKey: 'blueprint' },
      { key: 'preview', labelKey: 'preview' },
      { key: 'save', labelKey: 'save' },
      { key: 'check', labelKey: 'check' },
      { key: 'reload', labelKey: 'reloadFromDisk' },
      { key: 'refresh', labelKey: 'refresh' },
      { key: 'popout', labelKey: 'popout' },
      { key: 'inky', labelKey: 'openInky' },
      { key: 'folder', labelKey: 'openFolder' },
    ]
    const ACTION_GROUPS = [
      ['filesPanel', 'composerPanel'],
      ['dir', 'vocab', 'outline', 'blueprint', 'preview'],
      ['save', 'check', 'reload', 'refresh', 'popout', 'inky'],
      ['folder'],
    ]
    const UI_COLORS_KEY = 'dsh-ink:ui-colors'
    const LANGUAGE_KEY = 'dsh-ink:language'
    const FOLD_ENABLED_KEY = 'dsh-ink:fold-enabled'
    const PROJECT_DIR_KEY = 'dsh-ink:project-dir'
    const MIN_ZOOM = 0.8
    const MAX_ZOOM = 2
    const ZOOM_STEP = 0.1
    const FONT_STACK = 'ui-monospace, SFMono-Regular, Consolas, monospace'
    // Extra scrollable blank space after the last line, like a web page.
    const EDITOR_BOTTOM_SPACE = 360
    // Keep the editor's vertical scrollbar inside its own pane instead of
    // sitting on the boundary with the preview pane.
    const EDITOR_SCROLLBAR_INSET = 8

    // Low-contrast tints that read on both light and dark backgrounds.
    const SPEAKER_TINTS = [
      [96, 165, 250],
      [139, 92, 246],
      [52, 211, 153],
      [251, 191, 36],
      [244, 114, 182],
      [45, 212, 191],
      [248, 113, 113],
      [148, 163, 184],
    ]
    const SPEAKER_TINT_ALPHA = 0.14
    const SYNTAX_TINT = [125, 140, 160]
    const SYNTAX_TINT_ALPHA = 0.1
    const PRESET_COLORS = ['#2563eb', '#7c3aed', '#0d9488', '#16a34a', '#d97706', '#db2777']

    function hashText(value) {
      let hash = 0
      for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) >>> 0
      }
      return hash
    }

    function tintRgba(rgb, alpha) {
      const safe = Math.max(0, Math.min(0.32, alpha))
      return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${safe})`
    }

    function speakerBandColor(value, strength) {
      const rgb = SPEAKER_TINTS[hashText(value) % SPEAKER_TINTS.length]
      return tintRgba(rgb, SPEAKER_TINT_ALPHA * strength)
    }

    function speakerDefaultHex(value) {
      const rgb = SPEAKER_TINTS[hashText(value) % SPEAKER_TINTS.length]
      return `#${rgb.map((part) => part.toString(16).padStart(2, '0')).join('')}`
    }

    function syntaxBandColor(strength) {
      return tintRgba(SYNTAX_TINT, SYNTAX_TINT_ALPHA * strength)
    }

    function isSyntaxInkLine(trimmed) {
      if (trimmed === '') return false
      if (/^=+/.test(trimmed)) return true
      if (trimmed.startsWith('~')) return true
      if (/^(VAR|CONST|INCLUDE|LIST|EXTERNAL)\b/.test(trimmed)) return true
      if (trimmed.startsWith('->') || trimmed.startsWith('<-')) return true
      if (/^[*+]/.test(trimmed)) return true
      if (trimmed.startsWith('-')) return true
      if (trimmed.startsWith('//') || trimmed.startsWith('/*')) return true
      return false
    }

    /** The #speaker value of a line: null when absent, '' for a blank speaker. */
    function speakerValueFromLine(line) {
      const match = line.match(/#speaker:([^#]*)/)
      return match === null ? null : match[1].trim()
    }

    /** Per source line: null, a speaker tint, or the uniform syntax tint. */
    function editorLineInfos(content) {
      const lines = content.split('\n')
      const infos = new Array(lines.length).fill(null)
      let currentSpeaker = null
      for (let index = 0; index < lines.length; index += 1) {
        const raw = lines[index]
        const trimmed = raw.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('/*')) {
          currentSpeaker = null
          continue
        }
        const speaker = speakerValueFromLine(raw)
        if (speaker !== null) {
          currentSpeaker = speaker
          infos[index] = { kind: 'speaker', speaker }
          continue
        }
        if (isSyntaxInkLine(trimmed)) {
          currentSpeaker = null
          continue
        }
        if (trimmed === '') {
          // A blank line gets no band, but a following paragraph line still
          // belongs to the speaker of the previous dialogue line.
          continue
        }
        if (currentSpeaker !== null) {
          infos[index] = { kind: 'speaker', speaker: currentSpeaker }
        }
      }
      return infos
    }

    function relativeLuminance(rgb) {
      const channel = (value) => {
        const normalized = value / 255
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
    }

    function parseHexColor(value) {
      const match = /^#([0-9a-f]{6})$/i.exec(String(value ?? ''))
      if (match === null) return null
      const int = parseInt(match[1], 16)
      return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
    }

    function normalizeHex(value, fallback) {
      return parseHexColor(value) === null ? fallback : String(value).toLowerCase()
    }

    function readableOn(hex) {
      const rgb = parseHexColor(hex)
      if (rgb === null) return '#ffffff'
      const luminance = relativeLuminance(rgb)
      const darkLuminance = relativeLuminance([15, 17, 21])
      const whiteContrast = 1.05 / (luminance + 0.05)
      const darkContrast = (luminance + 0.05) / (darkLuminance + 0.05)
      return darkContrast >= whiteContrast ? '#0f1115' : '#ffffff'
    }

    function isDarkCssColor(value) {
      const match = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(String(value ?? ''))
      if (match === null) return false
      return relativeLuminance([Number(match[1]), Number(match[2]), Number(match[3])]) < 0.5
    }

    const zh = {
      rail: 'Ink',
      panelTitle: 'Ink 写作',
      project: '项目',
      save: '保存',
      saveHint: 'Ctrl+S',
      check: '检查',
      openInky: '在 Inky 打开',
      openFolder: '打开目录',
      refresh: '刷新',
      newFile: '新建',
      files: '文件',
      filesPanel: '文件栏',
      composerPanel: '写一句栏',
      closeTab: '关闭文件',
      closeDirtyTab: '该文件有未保存的修改，关闭将丢弃这些修改。继续？',
      welcomeTitle: '开始写作',
      welcomeSubtitle: '打开一个 Ink 文件，或从最近修改的文件继续。',
      welcomePathPlaceholder: '输入项目内文件路径（如 main.ink）或文件夹路径',
      open: '打开',
      chooseFolder: '选择文件夹…',
      recentFiles: '最近修改',
      noRecentFiles: '还没有最近文件',
      noFiles: '这个文件夹里没有 .ink 文件',
      up: '上一级',
      rootFolder: '项目根',
      selectFile: '从左边选一个文件，或新建一个',
      loading: '加载中…',
      saved: '已保存',
      savedToDisk: '已写入磁盘',
      unsaved: '未保存',
      savedState: '已保存',
      staleTitle: '磁盘上的文件已被改动',
      restoreTitle: '发现自动备份',
      restoreBody: '有一份未保存的自动副本，是否用它覆盖当前编辑器内容？备份时间：',
      restoreApply: '恢复备份',
      restoreKeep: '保留当前',
      staleBody: '可能是 Inky 刚保存过。你可以重读磁盘内容（丢弃当前修改），或直接覆盖保存。',
      overwrite: '覆盖保存',
      reloadFromDisk: '重读磁盘',
      refresh: '刷新',
      refreshHint: '刷新文件列表、词库和项目状态',
      refreshed: '已刷新',
      popout: '独立窗口',
      popoutClose: '关闭独立窗口',
      popoutHint: '在单独窗口打开 Ink 面板',
      popupBlocked: '窗口被浏览器拦截，请允许弹窗后重试',
      reload: '重读',
      discardPrompt: '当前文件还没保存，切换会丢失修改。继续吗？',
      composerTitle: '写一句',
      lineText: '台词 / 选项文本',
      lineTextPlaceholder: '例如：门打开了',
      lineKind: '行类型',
      kindLine: '台词',
      kindChoiceStar: '选项 *（一次性）',
      kindChoicePlus: '选项 +（可重复）',
      kindDivert: '跳转 ->',
      target: '跳转到',
      targetPlaceholder: 'knot 或 stitch 名',
      tagsTitle: '# 标签',
      tagNone: '（不写）',
      tagEmpty: '（空值）',
      tagCustom: '自定义值',
      addTag: '记入词库',
      addKey: '＋ 标签键',
      addKeyPlaceholder: '新标签键',
      preview: '预览',
      insert: '插入新句',
      applyTags: '只给当前行加标签',
      inserted: '已插入，按 Ctrl+S 保存',
      applied: '标签已写入当前行，按 Ctrl+S 保存',
      noLine: '先把光标放到一行里',
      issues: '检查结果',
      noIssues: '没有语法问题',
      issueNone: '文件',
      line: '行',
      col: '列',
      chars: '字',
      readFailed: '读取失败',
      writeFailed: '保存失败',
      lintFailed: '检查失败',
      newFilePrompt: '新文件名（不用写 .ink）',
      newFolderPrompt: '新文件夹名',
      createFile: 'ink 文件',
      createFolder: '文件夹',
      createKindHint: '新建类型：ink 文件或文件夹',
      folderExists: '同名文件夹已存在',
      fileExists: '同名文件已存在',
      inkyMissing: '找不到 Inky 可执行文件，请在插件配置里修改 inkyPath',
      openFailed: '打开失败',
      checked: '检查完成',
      conflict: '文件在磁盘上被改过',
      emptyText: '先写点台词',
      footerHint: '保存后 Inky 会自动重新载入（Inky 监视文件变化）。',
      zoomHint: 'Alt+滚轮缩放，点百分比复位',
      resetZoom: '复位缩放',
      wrapAuto: '折行：自动',
      wrapPreview: '折行：同预览',
      wrapHint: '折行宽度：同预览 = 按右侧预览框的宽度软折行（不会写入换行）；自动 = 填满编辑区',
      undoHint: 'Ctrl+Z 撤回 · Ctrl+Y 重做',
      presets: '预设',
      preset: '预设',
      addPreset: '添加预设',
      savePreset: '存预设',
      applyPreset: '套用这个预设',
      presetSaved: '预设已保存',
      presetDeleted: '预设已删除',
      deletePreset: '删除预设',
      deletePresetConfirm: '删除这个预设？',
      presetHint: '点预设套用；+ 用当前设置新建；「存预设」更新当前预设',
      preview: '预览',
      previewTitle: '左右对照预览：停止编辑后自动重新编译并从头播放',
      previewRestart: '重新开始',
      previewLoading: '编译中…',
      previewFailed: '预览失败',
      variableGlobal: '全局',
      variableCurrent: '当前',
      variables: '变量',
      toggleVariables: '展开/收起变量',
      previewEnd: '— 结束 —',
      labelModeIcons: '切换为纯图标',
      labelModeBoth: '切换为文字+图标',
      displayMode: '显示',
      railDragHint: '拖动调整位置（左侧 / 顶部）；点击切换',
      backToTop: '回到顶部',
      appearance: '外观',
      accentLight: '浅色主题强调色',
      accentDark: '深色主题强调色',
      bandTints: '行背景标识',
      bandStrength: '标识强度',
      enabled: '已开启',
      disabled: '已关闭',
      resetAppearance: '恢复默认',
      appearanceHint: '强调色用于主按钮、折叠标题等；行背景标识只给说话人（及其续行）上底色，可逐个改说话人颜色；语法/代码行和空行一样不上底色。',
      language: '语言',
      languageAuto: '自动',
      languageZh: '中文',
      languageEn: 'English',
      foldView: '折叠',
      foldTitle: '折叠查看',
      foldHint: '点击标题收起/展开内容；此视图只读，点「编辑」返回',
      foldEdit: '编辑',
      foldExpandAll: '全部展开',
      foldSection: '折叠查看',
      foldEnabled: '启用折叠',
      foldMarkersHint: '启用后行号左侧显示更大的折叠箭头；折叠时只有被隐藏的内容不可选择/编辑，其余（包括标题）都能编辑；跨折叠边界的编辑请先展开该块',
      foldHighlight: '折叠标题高亮',
      speakerColors: '说话人颜色',
      speakerLabel: '说话人',
      speakerBlank: '空格（#speaker:）',
      speakerDefault: '默认',
      resetSpeakerColor: '恢复默认颜色',
      interface: '界面',
      interfaceButtons: '界面按钮',
      interfaceHint: '勾选的按钮会显示在工具栏；未勾选的隐藏。外观和界面按钮始终保留。',
      buttonStyle: '按钮显示方式',
      styleBoth: '文字+图标',
      styleIcons: '纯图标',
      selectAll: '全选',
      selectNone: '全不选',
      resetButtons: '恢复默认',
      foldedActive: '已折叠',
      foldNoNewline: '折叠时不能增删行，请展开后再改行',
      foldNoCross: '不能跨折叠边界编辑，请展开该块',
      foldUnfoldFirst: '此操作需要先全部展开折叠',
      foldOpen: '打开折叠视图',
      collapseFiles: '收起文件栏',
      expandFiles: '展开文件栏',
      collapseComposer: '收起写一句栏',
      expandComposer: '展开写一句栏',
      dragResize: '拖动边缘调整宽度，双击复位',
      switchDir: '切换目录',
      switchDirHint: '输入或浏览另一个文件夹作为 Ink 项目目录',
      switchDirPrompt: '输入项目文件夹路径',
      switchDirEmpty: '路径不能为空',
      ok: '确定',
      cancel: '取消',
      browse: '浏览…',
      useDefault: '默认目录',
      pickerUnavailable: '系统文件夹选择框不可用，请直接输入或粘贴路径',
      vocab: '词库',
      vocabTitle: '词库编辑',
      vocabHint: '来自文件的值是只读的（随文件扫描自动出现）；这里可以增删浏览器记住的自定义值，也可以新增或删除自定义标签键。',
      fromFile: '来自文件',
      custom: '自定义',
      defaultKey: '默认',
      scannedKey: '文件中',
      addValuePlaceholder: '添加值',
      addValue: '添加',
      deleteKey: '删除此键',
      removeValue: '移除',
      close: '关闭',
      outline: '结构',
      outlineTitle: '项目结构',
      outlineHint: '按文件列出 knot / stitch / 函数 / 全局声明；点击条目跳到对应行，跨文件目标会自动打开对应文件。',
      outlineLoading: '正在读取项目…',
      outlineEmpty: '项目里还没有 .ink 文件。',
      outlineKnots: 'knots',
      outlineStitches: 'stitches',
      outlineFunctions: '函数',
      outlineFiles: '文件',
      outlineIntro: '文件开头',
      outlineGlobals: '全局声明',
      outlineCurrent: '当前',
      outlineUndefined: '未定义',
      outlineNoStructure: '没有 knot / stitch / 声明',
      outlineRefresh: '刷新',
      outlineTruncated: '文件过多或过大，部分文件没有载入。',
      outlineSkipped: '个文件过大已跳过',
      blueprint: '蓝图',
      blueprintTitle: '当前文件蓝图',
      blueprintHint: '滚轮缩放；空白处拖拽框选；拖动已选节点整体移动；双击节点跳到对应行；中键拖动平移画布。',
      blueprintEmpty: '这个文件还没有 knot / stitch。',
      blueprintRelayout: '重新布局',
      blueprintZoomReset: '恢复 100%',
      kindValue: '值',
      kindTag: '标签',
      kindKnot: 'knot',
      kindStitch: 'stitch',
      kindVar: '变量',
      kindFunction: '函数',
      kindKeyword: '关键字',
    }

    const en = {
      rail: 'Ink',
      panelTitle: 'Ink Writing',
      project: 'Project',
      save: 'Save',
      saveHint: 'Ctrl+S',
      check: 'Check',
      openInky: 'Open in Inky',
      openFolder: 'Open folder',
      refresh: 'Refresh',
      newFile: 'New',
      files: 'Files',
      filesPanel: 'Files panel',
      composerPanel: 'Composer panel',
      closeTab: 'Close file',
      closeDirtyTab: 'This file has unsaved changes; closing will discard them. Continue?',
      welcomeTitle: 'Start writing',
      welcomeSubtitle: 'Open an Ink file, or continue with a recently modified file.',
      welcomePathPlaceholder: 'Project file path (e.g. main.ink) or a folder path',
      open: 'Open',
      chooseFolder: 'Choose folder…',
      recentFiles: 'Recently modified',
      noRecentFiles: 'No recent files yet',
      noFiles: 'No .ink files in this folder',
      up: 'Up',
      rootFolder: 'Project root',
      selectFile: 'Pick a file on the left, or create one',
      loading: 'Loading…',
      saved: 'Saved',
      savedToDisk: 'Written to disk',
      unsaved: 'Unsaved',
      savedState: 'Saved',
      staleTitle: 'The file changed on disk',
      restoreTitle: 'Autosaved copy found',
      restoreBody: 'An unsaved autosaved copy exists. Use it to overwrite the editor content? Saved at:',
      restoreApply: 'Restore copy',
      restoreKeep: 'Keep current',
      staleBody: 'Inky may have just saved. Reload from disk (discarding your changes) or overwrite it.',
      overwrite: 'Overwrite',
      reloadFromDisk: 'Reload',
      refresh: 'Refresh',
      refreshHint: 'Refresh the file list, vocabulary and project state',
      refreshed: 'Refreshed',
      popout: 'Pop out',
      popoutClose: 'Close window',
      popoutHint: 'Open the Ink panel in a separate window',
      popupBlocked: 'The browser blocked the window; allow popups and retry',
      reload: 'Reload',
      discardPrompt: 'The current file has unsaved changes. Switch anyway?',
      composerTitle: 'Write a line',
      lineText: 'Dialogue / choice text',
      lineTextPlaceholder: 'e.g. The door opened',
      lineKind: 'Line kind',
      kindLine: 'Line',
      kindChoiceStar: 'Choice * (once)',
      kindChoicePlus: 'Choice + (sticky)',
      kindDivert: 'Divert ->',
      target: 'Goto',
      targetPlaceholder: 'knot or stitch name',
      tagsTitle: '# Tags',
      tagNone: '(omit)',
      tagEmpty: '(empty)',
      tagCustom: 'Custom value',
      addTag: 'Remember value',
      addKey: '+ Tag key',
      addKeyPlaceholder: 'New tag key',
      preview: 'Preview',
      insert: 'Insert line',
      applyTags: 'Tag current line',
      inserted: 'Inserted — press Ctrl+S to save',
      applied: 'Tags applied — press Ctrl+S to save',
      noLine: 'Place the caret in a line first',
      issues: 'Issues',
      noIssues: 'No syntax problems',
      issueNone: 'File',
      line: 'Line',
      col: 'Col',
      chars: 'chars',
      readFailed: 'Read failed',
      writeFailed: 'Save failed',
      lintFailed: 'Check failed',
      newFilePrompt: 'New file name (.ink optional)',
      newFolderPrompt: 'New folder name',
      createFile: 'Ink file',
      createFolder: 'Folder',
      createKindHint: 'Create an ink file or a folder',
      folderExists: 'A folder with that name already exists',
      fileExists: 'A file with that name already exists',
      inkyMissing: 'Inky executable not found; adjust inkyPath in the plugin config',
      openFailed: 'Open failed',
      checked: 'Check finished',
      conflict: 'The file changed on disk',
      emptyText: 'Write some dialogue first',
      footerHint: 'Inky watches the file on disk and reloads after a save.',
      zoomHint: 'Alt+wheel to zoom, click the percentage to reset',
      resetZoom: 'Reset zoom',
      wrapAuto: 'Wrap: auto',
      wrapPreview: 'Wrap: like preview',
      wrapHint: 'Wrap width: like preview = soft-wrap at the preview box width (no newline is written); auto = fill the editor',
      undoHint: 'Ctrl+Z undo · Ctrl+Y redo',
      presets: 'Presets',
      preset: 'Preset',
      addPreset: 'Add preset',
      savePreset: 'Save preset',
      applyPreset: 'Apply this preset',
      presetSaved: 'Preset saved',
      presetDeleted: 'Preset deleted',
      deletePreset: 'Delete preset',
      deletePresetConfirm: 'Delete this preset?',
      presetHint: 'Click a preset to apply; + creates one from the current setup; Save preset updates it',
      preview: 'Preview',
      previewTitle: 'Side-by-side preview: recompiles and restarts when editing pauses',
      previewRestart: 'Restart',
      previewLoading: 'Compiling…',
      previewFailed: 'Preview failed',
      variableGlobal: 'Global',
      variableCurrent: 'Current',
      variables: 'Variables',
      toggleVariables: 'Expand or collapse variables',
      previewEnd: '— The End —',
      labelModeIcons: 'Switch to icons only',
      labelModeBoth: 'Switch to icons + text',
      displayMode: 'Display',
      railDragHint: 'Drag to reposition (left / top); click to switch',
      backToTop: 'Back to top',
      appearance: 'Appearance',
      accentLight: 'Light theme accent',
      accentDark: 'Dark theme accent',
      bandTints: 'Line backgrounds',
      bandStrength: 'Tint strength',
      enabled: 'On',
      disabled: 'Off',
      resetAppearance: 'Reset',
      appearanceHint: 'The accent colors primary buttons and fold titles. Line backgrounds only tint speaker lines (and their continuation); per-speaker colors are editable. Syntax/code lines stay uncolored like blank lines.',
      language: 'Language',
      languageAuto: 'Auto',
      languageZh: '中文',
      languageEn: 'English',
      foldView: 'Fold',
      foldTitle: 'Fold view',
      foldHint: 'Click a heading to collapse/expand its content; this view is read-only, use Edit to return',
      foldEdit: 'Edit',
      foldExpandAll: 'Expand all',
      foldSection: 'Folding',
      foldEnabled: 'Enable folding',
      foldMarkersHint: 'When enabled, larger fold arrows appear left of line numbers. While folded only hidden content is locked; all visible lines (including titles) stay editable. Expand a block to edit across its boundary.',
      foldHighlight: 'Folded title highlight',
      speakerColors: 'Speaker colors',
      speakerLabel: 'Speaker',
      speakerBlank: 'Blank (#speaker:)',
      speakerDefault: 'Default',
      resetSpeakerColor: 'Reset to default color',
      interface: 'UI',
      interfaceButtons: 'Interface buttons',
      interfaceHint: 'Checked buttons are shown in the toolbar; unchecked ones are hidden. The Appearance and UI buttons always stay visible.',
      buttonStyle: 'Button style',
      styleBoth: 'Icon + text',
      styleIcons: 'Icons only',
      selectAll: 'All',
      selectNone: 'None',
      resetButtons: 'Reset',
      foldedActive: 'Folded',
      foldNoNewline: 'Cannot add or remove lines while folded; expand first',
      foldNoCross: 'Cannot edit across a fold boundary; expand that block',
      foldUnfoldFirst: 'Expand all folds first for this action',
      foldOpen: 'Open fold view',
      collapseFiles: 'Collapse file panel',
      expandFiles: 'Expand file panel',
      collapseComposer: 'Collapse composer panel',
      expandComposer: 'Expand composer panel',
      dragResize: 'Drag the edge to resize, double-click to reset',
      switchDir: 'Change folder',
      switchDirHint: 'Type or browse another folder as the Ink project directory',
      switchDirPrompt: 'Project folder path',
      switchDirEmpty: 'Path must not be empty',
      ok: 'OK',
      cancel: 'Cancel',
      browse: 'Browse…',
      useDefault: 'Default',
      pickerUnavailable: 'Folder picker unavailable; type or paste a path',
      vocab: 'Vocabulary',
      vocabTitle: 'Tag vocabulary',
      vocabHint: 'Values scanned from files are read-only. Here you can add or remove the custom values remembered by this browser, and add or delete custom tag keys.',
      fromFile: 'from files',
      custom: 'custom',
      defaultKey: 'default',
      scannedKey: 'in files',
      addValuePlaceholder: 'Add value',
      addValue: 'Add',
      deleteKey: 'Delete key',
      removeValue: 'Remove',
      close: 'Close',
      outline: 'Structure',
      outlineTitle: 'Project structure',
      outlineHint: 'Knots, stitches, functions and globals grouped by file. Click an entry to jump; cross-file targets open the other file.',
      outlineLoading: 'Reading project…',
      outlineEmpty: 'No .ink files in the project.',
      outlineKnots: 'knots',
      outlineStitches: 'stitches',
      outlineFunctions: 'functions',
      outlineFiles: 'files',
      outlineIntro: 'File start',
      outlineGlobals: 'Globals',
      outlineCurrent: 'current',
      outlineUndefined: 'undefined',
      outlineNoStructure: 'No knots / stitches / declarations',
      outlineRefresh: 'Refresh',
      outlineTruncated: 'Too many or too large files; some were not loaded.',
      outlineSkipped: 'files skipped (too large)',
      blueprint: 'Blueprint',
      blueprintTitle: 'Current file blueprint',
      blueprintHint: 'Wheel to zoom; drag empty space to box-select; drag a selected node to move the whole selection; double-click a node to jump; middle-drag to pan.',
      blueprintEmpty: 'This file has no knots / stitches yet.',
      blueprintRelayout: 'Re-layout',
      blueprintZoomReset: 'Reset to 100%',
      kindValue: 'value',
      kindTag: 'tag',
      kindKnot: 'knot',
      kindStitch: 'stitch',
      kindVar: 'var',
      kindFunction: 'function',
      kindKeyword: 'keyword',
    }

    let baseTranslate = (key) => key
    let languageOverride = 'auto'
    function t(key) {
      if (languageOverride === 'zh' || languageOverride === 'en') {
        const locale = languageOverride === 'zh' ? zh : en
        const value = locale[key]
        if (typeof value === 'string') return value
      }
      return baseTranslate(key)
    }

    // ------------------------------------------------------------------ styles

    const BTN = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      height: 26,
      padding: '0 10px',
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: 6,
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: 12,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }

    // The theme's brand token is near-white in dark mode, so a solid primary
    // button built on it turns into a white block with white text. Use a fixed
    // accessible blue instead: white text keeps >4.5:1 contrast in both themes.
    const BTN_PRIMARY = {
      ...BTN,
      background: 'var(--dsh-ink-accent, #2563eb)',
      borderColor: 'var(--dsh-ink-accent, #1d4ed8)',
      color: 'var(--dsh-ink-accent-contrast, #fff)',
    }

    /** Hand-drawn minimal line icons used by the panel buttons. */
    function ActionIcon({ name, size }) {
      const common = {
        width: size ?? 14,
        height: size ?? 14,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: 'false',
        style: { flex: '0 0 auto' },
      }
      const shapes = {
        folder: [
          h('path', {
            d: 'M3.5 7.5a2 2 0 0 1 2-2h3.6l1.9 2h7.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z',
          }),
        ],
        folderOpen: [
          h('path', { d: 'M3.5 9.5h17l-2.2 8.5H5.7z' }),
          h('path', { d: 'M3.5 9.5V7a2 2 0 0 1 2-2h3.6l1.9 2h6.6a2 2 0 0 1 2 2v0.5' }),
        ],
        tag: [
          h('path', { d: 'M4.5 4.5h6.8l8.2 8.2-6.8 6.8-8.2-8.2z' }),
          h('circle', { cx: 8.2, cy: 8.2, r: 1.1 }),
        ],
        outline: [
          h('path', { d: 'M6 5v14' }),
          h('path', { d: 'M10 7h8' }),
          h('path', { d: 'M10 12h6' }),
          h('path', { d: 'M10 17h9' }),
        ],
        blueprint: [
          h('path', { d: 'M6.5 7h4' }),
          h('path', { d: 'M13.5 7h4' }),
          h('path', { d: 'M12 9v5' }),
          h('circle', { cx: 5, cy: 7, r: 1.6 }),
          h('circle', { cx: 19, cy: 7, r: 1.6 }),
          h('circle', { cx: 12, cy: 17, r: 1.6 }),
        ],
        preview: [h('path', { d: 'M8.5 5.5l10 6.5-10 6.5z' })],
        save: [
          h('path', { d: 'M12 4v10' }),
          h('path', { d: 'M8 10l4 4 4-4' }),
          h('path', { d: 'M5 19h14' }),
        ],
        check: [h('path', { d: 'M5 12.5l4.5 4.5L19 6.5' })],
        reload: [
          h('path', { d: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3' }),
          h('path', { d: 'M19.5 4.5v4h-4' }),
        ],
        refresh: [
          h('path', { d: 'M4.5 12a7.5 7.5 0 0 1 12.8-5.3L20 9' }),
          h('path', { d: 'M20 4v5h-5' }),
          h('path', { d: 'M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4 15' }),
          h('path', { d: 'M4 20v-5h5' }),
        ],
        external: [
          h('path', { d: 'M14 4h6v6' }),
          h('path', { d: 'M20 4l-9 9' }),
          h('path', { d: 'M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4' }),
        ],
        mode: [
          h('rect', { x: 4, y: 5, width: 16, height: 14, rx: 2 }),
          h('path', { d: 'M4 12h16' }),
          h('path', { d: 'M12 5v7' }),
        ],
        grip: [
          h('circle', { cx: 9, cy: 7, r: 1.2, fill: 'currentColor', stroke: 'none' }),
          h('circle', { cx: 15, cy: 7, r: 1.2, fill: 'currentColor', stroke: 'none' }),
          h('circle', { cx: 9, cy: 12, r: 1.2, fill: 'currentColor', stroke: 'none' }),
          h('circle', { cx: 15, cy: 12, r: 1.2, fill: 'currentColor', stroke: 'none' }),
          h('circle', { cx: 9, cy: 17, r: 1.2, fill: 'currentColor', stroke: 'none' }),
          h('circle', { cx: 15, cy: 17, r: 1.2, fill: 'currentColor', stroke: 'none' }),
        ],
        arrowUp: [
          h('path', { d: 'M12 19V5' }),
          h('path', { d: 'M6 11l6-6 6 6' }),
        ],
        window: [
          h('rect', { x: 3.5, y: 5, width: 17, height: 14, rx: 2 }),
          h('path', { d: 'M3.5 9h17' }),
          h('circle', { cx: 6.3, cy: 7, r: 0.8, fill: 'currentColor', stroke: 'none' }),
        ],
        sidebar: [
          h('rect', { x: 3.5, y: 5, width: 17, height: 14, rx: 2 }),
          h('path', { d: 'M9 5v14' }),
        ],
        compose: [
          h('path', { d: 'M4 20h4L19 9l-4-4L4 16z' }),
          h('path', { d: 'M14 6l4 4' }),
        ],
        palette: [
          h('path', {
            d: 'M12 3a9 9 0 1 0 0 18c1.4 0 2.1-1 1.4-2.2-.7-1.2.2-2.3 1.6-2.3H17a4 4 0 0 0 4-4c0-5.2-4-9.5-9-9.5z',
          }),
          h('circle', { cx: 7.5, cy: 10, r: 1, fill: 'currentColor', stroke: 'none' }),
          h('circle', { cx: 10, cy: 7, r: 1, fill: 'currentColor', stroke: 'none' }),
          h('circle', { cx: 14, cy: 7, r: 1, fill: 'currentColor', stroke: 'none' }),
        ],
        fold: [
          h('path', { d: 'M9 5L4 12l5 7' }),
          h('path', { d: 'M15 5l5 7-5 7' }),
        ],
      }
      return h('svg', common, ...(shapes[name] ?? shapes.mode))
    }

    const INPUT = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '5px 8px',
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: 6,
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: 12,
      outline: 'none',
    }

    const S = {
      root: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        position: 'relative',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
      },
      header: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '9px 14px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        flexWrap: 'wrap',
      },
      title: { fontSize: 14, fontWeight: 600, marginRight: 2 },
      meta: {
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 11,
        maxWidth: 320,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      spacer: { flex: 1 },
      body: { display: 'flex', flex: 1, minHeight: 0 },
      actionRail: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 6,
        padding: '8px 6px',
        borderRight: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        flex: '0 0 auto',
        minHeight: 0,
      },
      actionBar: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        flexWrap: 'wrap',
        justifyContent: 'flex-start',
      },
      dragHandle: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 20,
        height: 20,
        padding: 0,
        border: 'none',
        borderRadius: 4,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'grab',
        flex: '0 0 auto',
        alignSelf: 'center',
      },
      rail: {
        width: 'clamp(170px, 19vw, 230px)',
        flex: '0 0 clamp(170px, 19vw, 230px)',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--dsw-alias-border-l1)',
        minHeight: 0,
      },
      railHead: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 10px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      railTitle: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' },
      fileList: { flex: 1, overflow: 'auto', padding: 6, minHeight: 0 },
      fileRow: (active) => ({
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '6px 8px',
        border: 'none',
        borderRadius: 6,
        background: active ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
        color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        font: 'inherit',
        fontSize: 12,
        cursor: 'pointer',
        wordBreak: 'break-all',
      }),
      editorCol: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 },
      editorTabs: {
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        flex: 1,
        minWidth: 0,
        overflowX: 'auto',
        overflowY: 'hidden',
        whiteSpace: 'nowrap',
        height: 26,
      },
      tabWrapper: { display: 'inline-flex', alignItems: 'center', maxWidth: 200, minWidth: 0, flex: '0 0 auto' },
      tab: (active) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        maxWidth: 180,
        minWidth: 0,
        height: 22,
        padding: '0 8px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 6,
        background: active ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
        color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 12,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        flex: '0 0 auto',
        opacity: active ? 1 : 0.85,
      }),
      tabClose: {
        width: 20,
        height: 20,
        marginLeft: 2,
        padding: 0,
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 4,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 11,
        alignSelf: 'center',
        flex: '0 0 auto',
      },
      welcome: {
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: '28px 32px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: 'var(--dsw-alias-bg-base)',
      },
      welcomeTitle: { fontSize: 22, fontWeight: 650, color: 'var(--dsw-alias-label-primary)' },
      welcomeSubtitle: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 8 },
      welcomeOpenRow: { display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 760 },
      recentGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 12,
        maxWidth: 960,
        marginTop: 6,
      },
      recentCard: {
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minWidth: 0,
        padding: 10,
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 8,
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit',
      },
      recentName: {
        fontSize: 13,
        fontWeight: 600,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      recentPath: {
        fontSize: 10,
        color: 'var(--dsw-alias-label-secondary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      recentPreview: {
        marginTop: 2,
        minHeight: 34,
        maxHeight: 52,
        overflow: 'hidden',
        padding: '4px 6px',
        borderRadius: 4,
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-secondary)',
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: 10,
        lineHeight: 1.4,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      },
      recentMeta: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)' },
      previewPane: {
        flex: '0 0 clamp(280px, 34%, 430px)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        borderLeft: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
      },
      previewHead: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 10px',
        height: 30,
        flex: '0 0 30px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      previewBody: {
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: '10px 12px 14px',
        fontSize: 13,
        lineHeight: '20px',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
        boxSizing: 'border-box',
        wordBreak: 'break-word',
      },
      previewVariable: {
        marginBottom: 6,
        padding: '4px 8px 4px 7px',
        borderLeft: '3px solid var(--dsh-ink-accent)',
        borderRadius: 4,
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 11,
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      },
      previewVariables: {
        flex: '0 0 auto',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 190,
        borderTop: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      previewVariablesHead: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
        userSelect: 'none',
      },
      previewVariablesBody: {
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        padding: '0 10px 8px',
      },
      previewVariableGroup: { display: 'flex', flexDirection: 'column', gap: 2 },
      previewVariableGroupLabel: {
        fontSize: 10,
        color: 'var(--dsw-alias-label-secondary)',
        opacity: 0.9,
      },
      previewVariableRow: {
        display: 'flex',
        alignItems: 'baseline',
        gap: 6,
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: 11,
      },
      previewVariableName: {
        maxWidth: '55%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: 'var(--dsw-alias-label-primary)',
      },
      previewVariableValue: {
        color: 'var(--dsw-alias-label-secondary)',
        wordBreak: 'break-word',
      },
      editorHead: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'nowrap',
        minWidth: 0,
        gap: 8,
        padding: '6px 12px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        fontSize: 12,
      },
      editorWrap: { display: 'flex', flex: 1, minHeight: 0, position: 'relative' },
      editorPane: { position: 'relative', flex: 1, minWidth: 0, minHeight: 0 },
      gutter: {
        width: 46,
        flex: '0 0 46px',
        margin: 0,
        boxSizing: 'border-box',
        overflow: 'hidden',
        padding: '8px 6px 8px 0',
        textAlign: 'right',
        color: 'var(--dsw-alias-label-secondary)',
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: 12,
        lineHeight: '20px',
        background: 'var(--dsw-alias-bg-base)',
        borderRight: '1px solid var(--dsw-alias-border-l1)',
        whiteSpace: 'pre',
        userSelect: 'none',
      },
      foldMarkerCol: {
        width: 24,
        flex: '0 0 24px',
        overflow: 'hidden',
        background: 'var(--dsw-alias-bg-base)',
      },
      textarea: {
        flex: 1,
        minWidth: 0,
        resize: 'none',
        border: 'none',
        outline: 'none',
        padding: '8px 10px',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: 13,
        lineHeight: '20px',
        whiteSpace: 'pre',
        overflow: 'auto',
        tabSize: 2,
      },
      backTop: {
        position: 'absolute',
        right: 16,
        bottom: 16,
        zIndex: 5,
        width: 32,
        height: 32,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        borderRadius: '50%',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-overlay)',
        color: 'var(--dsw-alias-label-primary)',
        boxShadow: '0 6px 16px rgba(0, 0, 0, 0.18)',
        cursor: 'pointer',
      },
      appearanceSection: {
        borderTop: '1px solid var(--dsw-alias-border-l1)',
        paddingTop: 10,
        marginTop: 10,
      },
      appearanceLabel: {
        fontSize: 12,
        fontWeight: 600,
        marginBottom: 6,
      },
      appearanceRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 6,
      },
      appearanceHex: {
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: 11,
        color: 'var(--dsw-alias-label-secondary)',
        minWidth: 64,
      },
      colorInput: {
        width: 40,
        height: 26,
        padding: 0,
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 6,
        background: 'transparent',
        cursor: 'pointer',
      },
      colorSwatch: (color, active) => ({
        width: 18,
        height: 18,
        padding: 0,
        borderRadius: '50%',
        border: active
          ? '2px solid var(--dsh-ink-accent)'
          : '1px solid var(--dsw-alias-border-l1)',
        background: color,
        cursor: 'pointer',
        boxSizing: 'border-box',
      }),
      colorReset: {
        width: 26,
        height: 26,
        padding: 0,
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 6,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 12,
      },
      rangeInput: {
        flex: 1,
        accentColor: 'var(--dsh-ink-accent)',
      },
      appearanceHint: {
        marginTop: 8,
        fontSize: 11,
        color: 'var(--dsw-alias-label-secondary)',
        lineHeight: '16px',
      },
      appearanceFooter: {
        display: 'flex',
        justifyContent: 'flex-end',
        marginTop: 12,
      },
      languageSelect: {
        height: 28,
        minWidth: 150,
        padding: '0 8px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 6,
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: 12,
        outline: 'none',
      },
      speakerSelect: {
        flex: 1,
        minWidth: 0,
        height: 28,
        padding: '0 8px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 6,
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: 12,
        outline: 'none',
      },
      foldOverlay: {
        position: 'absolute',
        inset: 0,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        background: 'var(--dsw-alias-bg-base)',
      },
      foldHead: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 10px',
        height: 30,
        flex: '0 0 30px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      foldBody: {
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: '4px 0 12px',
      },
      composer: {
        width: 'clamp(250px, 25vw, 320px)',
        flex: '0 0 clamp(250px, 25vw, 320px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        borderLeft: '1px solid var(--dsw-alias-border-l1)',
        padding: 12,
        overflow: 'auto',
        minHeight: 0,
      },
      sectionLabel: {
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--dsw-alias-label-secondary)',
        marginTop: 2,
      },
      tagRow: { display: 'flex', alignItems: 'center', gap: 6 },
      tagKey: {
        width: 74,
        flex: '0 0 74px',
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: 11,
        color: 'var(--dsw-alias-label-secondary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      preview: {
        padding: '6px 8px',
        borderRadius: 6,
        background: 'var(--dsw-alias-bg-layer-2)',
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: 12,
        lineHeight: '18px',
        wordBreak: 'break-all',
        whiteSpace: 'pre-wrap',
        minHeight: 32,
      },
      issuePanel: {
        maxHeight: 148,
        overflow: 'auto',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
        padding: '4px 10px',
      },
      issueRow: {
        display: 'flex',
        gap: 8,
        padding: '3px 2px',
        fontSize: 12,
        cursor: 'pointer',
        borderRadius: 4,
      },
      footer: {
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '0 12px',
        height: 26,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 11,
      },
      banner: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        fontSize: 12,
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
      },
      dirBar: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      dirLabel: {
        fontSize: 12,
        color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'nowrap',
      },
      crumb: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 2,
        padding: '4px 8px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        fontSize: 11,
        maxHeight: 52,
        overflowY: 'auto',
      },
      crumbLink: (active) => ({
        border: 'none',
        background: 'transparent',
        color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        font: 'inherit',
        fontSize: 11,
        fontWeight: active ? 600 : 400,
        padding: '1px 3px',
        borderRadius: 4,
        cursor: 'pointer',
      }),
      crumbSep: {
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 11,
      },
      createRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 8px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      modalBackdrop: {
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(0, 0, 0, 0.28)',
      },
      modalCard: {
        width: 560,
        maxWidth: '100%',
        maxHeight: '82%',
        overflow: 'auto',
        boxSizing: 'border-box',
        padding: 16,
        borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-overlay)',
        boxShadow: '0 18px 48px rgba(0, 0, 0, 0.28)',
      },
      modalHead: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 6,
      },
      blueprintCard: {
        width: 'min(1120px, 96%)',
        height: '84%',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        padding: 14,
        borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-overlay)',
        boxShadow: '0 18px 48px rgba(0, 0, 0, 0.28)',
      },
      blueprintCanvas: {
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 8,
        background: 'var(--dsw-alias-bg-base)',
      },
      vocabChip: {
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 6px',
        borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        fontSize: 11,
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
      },
      resizerStrip: {
        position: 'relative',
        flex: '0 0 5px',
        alignSelf: 'stretch',
        cursor: 'col-resize',
        zIndex: 5,
      },
      resizerButton: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 30,
        padding: 0,
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 10,
        lineHeight: 1,
        cursor: 'pointer',
        zIndex: 6,
      },
      notice: {
        padding: '5px 14px',
        fontSize: 12,
        color: 'var(--dsw-alias-label-secondary)',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
    }

    // ------------------------------------------------------------------- utils

    function readStorage(key, fallback) {
      try {
        const raw = localStorage.getItem(key)
        return raw === null ? fallback : JSON.parse(raw)
      } catch {
        return fallback
      }
    }

    function writeStorage(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch {
        // a blocked storage only costs the remembered preference
      }
    }

    function escapeRegExp(text) {
      return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }

    // ----------------------------------------------------------- highlighting

    const HL_KEYWORDS = new Set([
      'VAR',
      'CONST',
      'LIST',
      'INCLUDE',
      'EXTERNAL',
      'FUNCTION',
      'TEMP',
      'RETURN',
      'ELSE',
      'IF',
      'NOT',
      'AND',
      'OR',
      'TRUE',
      'FALSE',
      'TODO',
      'END',
      'DONE',
      'CHOICE_COUNT',
      'TURNS',
      'TURNS_SINCE',
      'READ_COUNT',
      'LIST_ALL',
      'LIST_COUNT',
      'LIST_MIN',
      'LIST_MAX',
      'LIST_RANDOM',
      'LIST_RANGE',
      'LIST_INVERT',
      'LIST_VALUE',
      'RANDOM',
      'SEED_RANDOM',
    ])

    const COMPLETION_KEYWORDS = [
      'VAR',
      'CONST',
      'LIST',
      'INCLUDE',
      'EXTERNAL',
      'temp',
      'return',
      'else',
      'not',
      'and',
      'or',
      'true',
      'false',
      'END',
      'DONE',
    ]

    const HL_STYLES = `
      .dsh-ink-hl {
        position: absolute;
        inset: 0;
        margin: 0;
        padding: 8px 10px;
        overflow: hidden;
        box-sizing: border-box;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-all;
        tab-size: 2;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        pointer-events: none;
        user-select: none;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        z-index: 0;
      }
      .dsh-ink-hl .t-comment { color: #8b95a5; }
      .dsh-ink-hl .t-tag { color: #a855f7; }
      .dsh-ink-hl .t-divert { color: #3b82f6; }
      .dsh-ink-hl .t-keyword { color: #c026d3; }
      .dsh-ink-hl .t-string { color: #d97706; }
      .dsh-ink-hl .t-number { color: #0d9488; }
      .dsh-ink-hl .t-brace { color: #b45309; }
      .dsh-ink-hl .t-bullet { color: #0891b2; }
      .dsh-ink-hl .t-header { color: #ca8a04; }
      .dsh-ink-editor::placeholder {
        color: var(--dsw-alias-label-secondary);
        -webkit-text-fill-color: var(--dsw-alias-label-secondary);
        opacity: 1;
      }
      .dsh-ink-editor::selection {
        background: rgba(59, 130, 246, 0.28);
      }
      .dsh-ink-resizer {
        background: transparent;
        transition: background .12s ease;
      }
      .dsh-ink-resizer:hover {
        background: rgba(59, 130, 246, 0.35);
      }
      @keyframes dsh-ink-preview-line-in {
        from { opacity: 0; transform: translateY(3px); }
        to { opacity: 1; transform: none; }
      }
      .dsh-ink-preview-line {
        animation: dsh-ink-preview-line-in 280ms ease-out;
        transition: opacity 320ms ease;
      }
      .dsh-ink-tip {
        position: relative;
      }
      .dsh-ink-tip::after {
        content: attr(data-tip);
        position: absolute;
        top: calc(100% + 7px);
        left: 50%;
        transform: translateX(-50%) translateY(-2px);
        padding: 3px 7px;
        border-radius: 5px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-overlay);
        color: var(--dsw-alias-label-primary);
        font-size: 11px;
        line-height: 16px;
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        z-index: 200;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
        transition: opacity 0.12s ease, transform 0.12s ease;
      }
      .dsh-ink-tip:hover::after,
      .dsh-ink-tip:focus-visible::after {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      .dsh-ink-rail .dsh-ink-tip::after {
        top: 50%;
        left: calc(100% + 8px);
        transform: translateY(-50%) translateX(-2px);
      }
      .dsh-ink-rail .dsh-ink-tip:hover::after,
      .dsh-ink-rail .dsh-ink-tip:focus-visible::after {
        opacity: 1;
        transform: translateY(-50%) translateX(0);
      }
      .dsh-ink-primary {
        transition: filter 0.12s ease;
      }
      .dsh-ink-primary:hover:not(:disabled) {
        filter: brightness(1.08);
      }
      .dsh-ink-primary:active:not(:disabled) {
        filter: brightness(0.94);
      }
      .dsh-ink-drag:hover {
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
      }
      .dsh-ink-drag:active {
        cursor: grabbing;
      }
      .dsh-ink-backtop:hover {
        background: var(--dsw-alias-bg-layer-2);
      }
      .dsh-ink-fold-marker:hover {
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-layer-2);
      }
    `

    function escapeHtml(text) {
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
    }

    function hlSpan(kind, text) {
      return `<span class="t-${kind}">${escapeHtml(text)}</span>`
    }

    /** Tokenize one ink source line into coloured HTML (block-comment state crosses lines). */
    function highlightInkLine(line, state) {
      const isHeader =
        /^\s*={2,}/.test(line) || /^\s*=\s*[A-Za-z_\u4e00-\u9fff0-9]/.test(line)
      const isLogic = /^\s*(?:~|\b(?:VAR|CONST|LIST|INCLUDE|EXTERNAL)\b|TODO:)/.test(line)
      const isChoice = /^\s*[*+]/.test(line)
      let out = ''
      let index = 0
      const length = line.length

      while (index < length) {
        if (state.inBlock) {
          const end = line.indexOf('*/', index)
          if (end === -1) {
            out += hlSpan('comment', line.slice(index))
            index = length
            break
          }
          out += hlSpan('comment', line.slice(index, end + 2))
          index = end + 2
          state.inBlock = false
          continue
        }
        const rest = line.slice(index)
        if (rest.startsWith('/*')) {
          const end = line.indexOf('*/', index + 2)
          if (end === -1) {
            out += hlSpan('comment', rest)
            state.inBlock = true
            index = length
            break
          }
          out += hlSpan('comment', line.slice(index, end + 2))
          index = end + 2
          continue
        }
        if (rest.startsWith('//')) {
          out += hlSpan('comment', rest)
          break
        }
        if (isHeader) {
          out += hlSpan('header', line)
          break
        }
        if (index === 0) {
          const bullet = /^(\s*)([*+])/.exec(line)
          if (bullet !== null) {
            out += escapeHtml(bullet[1]) + hlSpan('bullet', bullet[2])
            index = bullet[0].length
            continue
          }
          const gather = /^(\s*)-(?=\s|$)/.exec(line)
          if (gather !== null) {
            out += escapeHtml(gather[1]) + hlSpan('bullet', '-')
            index = gather[1].length + 1
            continue
          }
        }
        if (rest.startsWith('->') || rest.startsWith('<-')) {
          const divert = /^(?:->|<-)\s*[A-Za-z0-9_\u4e00-\u9fff.]*/.exec(rest)
          out += hlSpan('divert', divert[0])
          index += divert[0].length
          continue
        }
        if (rest[0] === '#' && !isLogic) {
          let end = length
          const next = line.indexOf('#', index + 1)
          if (next !== -1) end = next
          const arrow = line.slice(index).search(/\s+(?:->|<-)/)
          if (arrow !== -1) end = Math.min(end, index + arrow)
          out += hlSpan('tag', line.slice(index, end))
          index = end
          continue
        }
        if (isLogic && rest[0] === '"') {
          const quote = line.indexOf('"', index + 1)
          const end = quote === -1 ? length : quote + 1
          out += hlSpan('string', line.slice(index, end))
          index = end
          continue
        }
        if (isLogic) {
          const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest)
          if (word !== null) {
            out += HL_KEYWORDS.has(word[0].toUpperCase())
              ? hlSpan('keyword', word[0])
              : escapeHtml(word[0])
            index += word[0].length
            continue
          }
          const number = /^\d+(?:\.\d+)?/.exec(rest)
          if (number !== null) {
            out += hlSpan('number', number[0])
            index += number[0].length
            continue
          }
          if (rest[0] === '~') {
            out += hlSpan('keyword', '~')
            index += 1
            continue
          }
        }
        if (rest[0] === '{' || rest[0] === '}') {
          out += hlSpan('brace', rest[0])
          index += 1
          continue
        }
        const special = isLogic ? /[~#{}\/"\dA-Za-z_]|->|<-/ : /[#{}\/]|->|<-/
        const match = special.exec(rest)
        const take = match === null ? rest.length : match.index === 0 ? 1 : match.index
        out += escapeHtml(rest.slice(0, take))
        index += take
      }

      return out
    }

    /** Colour the whole ink source. Very large files fall back to plain text. */
    function highlightInk(source) {
      if (source === '' || source.length > 300000) return ''
      const lines = source.split('\n')
      const state = { inBlock: false }
      const parts = []
      for (let index = 0; index < lines.length; index += 1) {
        parts.push(highlightInkLine(lines[index], state))
      }
      return parts.join('\n')
    }

    /**
     * Structural outline of one ink file: knots with their stitches and
     * diverts, functions, globals, and a name→line map for resolving divert
     * targets to a jumpable line.
     */
    function parseInkOutline(source) {
      const lines = source.split('\n')
      const result = { includes: [], variables: [], intro: [], knots: [], functions: [] }
      const nameToLine = {}
      let currentKnot = null
      let currentStitch = null
      let currentFunction = null

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        const lineNo = index + 1
        if (/^\s*\/\//.test(line)) continue

        const functionMatch = /^\s*={2,}\s*function\s+([A-Za-z0-9_\u4e00-\u9fff]+)/.exec(line)
        if (functionMatch !== null) {
          currentKnot = null
          currentStitch = null
          const node = { id: `fn:${lineNo}`, name: functionMatch[1], line: lineNo, diverts: [] }
          result.functions.push(node)
          nameToLine[node.name] = lineNo
          currentFunction = node
          continue
        }
        const knotMatch = /^\s*={2,}\s*([A-Za-z0-9_\u4e00-\u9fff]+)/.exec(line)
        if (knotMatch !== null) {
          currentStitch = null
          currentFunction = null
          const node = {
            id: `k:${lineNo}`,
            name: knotMatch[1],
            line: lineNo,
            stitches: [],
            diverts: [],
          }
          result.knots.push(node)
          nameToLine[node.name] = lineNo
          currentKnot = node
          continue
        }
        const stitchMatch = /^\s*=\s*([A-Za-z0-9_\u4e00-\u9fff]+)/.exec(line)
        if (stitchMatch !== null && currentKnot !== null) {
          const node = { id: `s:${lineNo}`, name: stitchMatch[1], line: lineNo, diverts: [] }
          currentKnot.stitches.push(node)
          nameToLine[node.name] = lineNo
          nameToLine[`${currentKnot.name}.${node.name}`] = lineNo
          currentStitch = node
          continue
        }
        const includeMatch = /^\s*INCLUDE\s+(\S.*)$/.exec(line)
        if (includeMatch !== null) {
          result.includes.push({ line: lineNo, text: includeMatch[1].trim() })
          continue
        }
        const variableMatch = /^\s*(VAR|CONST|LIST)\s+([A-Za-z0-9_\u4e00-\u9fff]+)/.exec(line)
        if (variableMatch !== null) {
          result.variables.push({
            line: lineNo,
            kind: variableMatch[1],
            name: variableMatch[2],
          })
          continue
        }

        const holder = currentStitch ?? currentKnot ?? currentFunction
        const divertPattern = /(?:->|<-)\s*([A-Za-z0-9_\u4e00-\u9fff.]+)/g
        let divertMatch
        while ((divertMatch = divertPattern.exec(line)) !== null) {
          const target = divertMatch[1]
          const entry = { target, line: lineNo }
          const targetList = holder === null ? result.intro : holder.diverts
          if (!targetList.some((item) => item.target === target)) targetList.push(entry)
        }
      }

      return { ...result, nameToLine }
    }

    /**
     * Node-graph data for one file: knots/stitches/functions/intro as nodes,
     * diverts as edges, plus a simple layered layout. The client can drag
     * nodes over these base positions.
     */
    function buildBlueprint(outline) {
      const nodes = []
      const nodeByLine = new Map()
      const nodeByName = new Map()
      const addNode = (node) => {
        nodes.push(node)
        nodeByLine.set(node.line, node)
        if (node.name) nodeByName.set(node.name, node)
      }
      for (const knot of outline.knots) {
        addNode({ id: `k:${knot.line}`, name: knot.name, label: knot.name, kind: 'knot', line: knot.line })
      }
      for (const knot of outline.knots) {
        for (const stitch of knot.stitches) {
          const node = {
            id: `s:${stitch.line}`,
            name: `${knot.name}.${stitch.name}`,
            label: `${knot.name} . ${stitch.name}`,
            kind: 'stitch',
            line: stitch.line,
          }
          addNode(node)
          nodeByName.set(stitch.name, node)
        }
      }
      for (const fn of outline.functions) {
        addNode({ id: `f:${fn.line}`, name: fn.name, label: fn.name, kind: 'function', line: fn.line })
      }
      let endNode = null
      let unknownNode = null
      const unresolved = new Set()
      const edges = []
      const ensureEnd = () => {
        if (endNode === null) {
          endNode = { id: '__end__', label: 'END', kind: 'end', line: 0 }
          nodes.push(endNode)
        }
        return endNode
      }
      const ensureUnknown = () => {
        if (unknownNode === null) {
          unknownNode = { id: '__unknown__', label: '未定义', kind: 'unknown', line: 0 }
          nodes.push(unknownNode)
        }
        return unknownNode
      }
      const pushDiverts = (source, diverts) => {
        for (const divert of diverts) {
          let target = null
          if (divert.target === 'END' || divert.target === 'DONE') {
            target = ensureEnd()
          } else {
            const line = outline.nameToLine[divert.target]
            target = line !== undefined ? nodeByLine.get(line) : null
            if (!target) target = nodeByName.get(divert.target) ?? null
            if (!target) {
              unresolved.add(divert.target)
              target = ensureUnknown()
            }
          }
          edges.push({
            from: source.id,
            to: target.id,
            target: divert.target,
            unknown: target.kind === 'unknown',
          })
        }
      }
      if (outline.intro.length > 0) {
        const introNode = { id: 'intro', name: '文件开头', label: '文件开头', kind: 'intro', line: 1 }
        nodes.push(introNode)
        pushDiverts(introNode, outline.intro)
      }
      for (const knot of outline.knots) {
        const source = nodeByLine.get(knot.line)
        if (source) {
          pushDiverts(source, knot.diverts)
          for (const stitch of knot.stitches) {
            const stitchNode = nodeByLine.get(stitch.line)
            if (stitchNode) pushDiverts(stitchNode, stitch.diverts)
          }
        }
      }
      for (const fn of outline.functions) {
        const source = nodeByLine.get(fn.line)
        if (source) pushDiverts(source, fn.diverts)
      }

      const outgoing = new Map(nodes.map((node) => [node.id, []]))
      const incoming = new Map(nodes.map((node) => [node.id, 0]))
      for (const edge of edges) {
        if (outgoing.has(edge.from)) outgoing.get(edge.from).push(edge.to)
        if (incoming.has(edge.to)) incoming.set(edge.to, incoming.get(edge.to) + 1)
      }
      const layer = new Map()
      let queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id)
      if (queue.length === 0 && nodes.length > 0) queue = [nodes[0].id]
      for (const id of queue) layer.set(id, 0)
      while (queue.length > 0) {
        const id = queue.shift()
        const next = layer.get(id) + 1
        for (const to of outgoing.get(id) ?? []) {
          if (!layer.has(to)) {
            layer.set(to, next)
            queue.push(to)
          }
        }
      }
      let maxLayer = 0
      for (const value of layer.values()) maxLayer = Math.max(maxLayer, value)
      for (const node of nodes) {
        if (!layer.has(node.id)) layer.set(node.id, maxLayer + 1)
      }
      const byLayer = new Map()
      for (const node of nodes) {
        const index = layer.get(node.id) ?? 0
        if (!byLayer.has(index)) byLayer.set(index, [])
        byLayer.get(index).push(node)
      }
      const base = {}
      let rows = 1
      for (const [index, list] of byLayer) {
        list.sort((a, b) => a.line - b.line)
        rows = Math.max(rows, list.length)
        list.forEach((node, row) => {
          base[node.id] = { x: 40 + index * 270, y: 40 + row * 130 }
        })
      }
      const lastLayer = byLayer.size === 0 ? 0 : Math.max(...byLayer.keys())
      return {
        nodes,
        edges,
        base,
        unresolved: [...unresolved],
        width: Math.max(900, 40 + (lastLayer + 1) * 270 + 240),
        height: Math.max(520, 40 + rows * 130 + 100),
      }
    }

    async function request(path, options) {
      const response = await fetch(API + path, options)
      let body = {}
      try {
        body = await response.json()
      } catch {
        body = {}
      }
      return { status: response.status, body: body ?? {} }
    }

    function postJson(path, payload) {
      return request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }

    /** Merge the vocabulary scanned from disk with locally remembered values. */
    function valuesOf(vocab, customTags, key) {
      const set = new Set()
      for (const value of vocab[key] ?? []) set.add(value)
      for (const value of customTags[key] ?? []) set.add(value)
      return [...set].sort((a, b) => a.localeCompare(b, 'zh'))
    }

    function Btn({ children, onClick, disabled, title, primary, style, icon, iconOnly, tip }) {
      const compact = icon !== undefined && iconOnly === true
      const label = typeof tip === 'string' ? tip : typeof children === 'string' ? children : ''
      const showTip = compact && label !== ''
      const className = [
        primary ? 'dsh-ink-primary' : '',
        showTip ? 'dsh-ink-tip' : '',
      ]
        .filter((name) => name !== '')
        .join(' ')
      return h(
        'button',
        {
          type: 'button',
          onClick,
          disabled: disabled === true,
          title: showTip ? undefined : title,
          'aria-label': showTip ? label : undefined,
          className: className === '' ? undefined : className,
          'data-tip': showTip ? label : undefined,
          style: {
            ...(primary ? BTN_PRIMARY : BTN),
            ...(compact ? { padding: 0, width: 26, gap: 0 } : null),
            opacity: disabled === true ? 0.5 : 1,
            ...style,
          },
        },
        icon !== undefined
          ? h(
              'span',
              { style: { display: 'inline-flex', alignItems: 'center', gap: compact ? 0 : 5 } },
              h(ActionIcon, { name: icon }),
              compact ? null : h('span', null, children),
            )
          : children,
      )
    }

    // ------------------------------------------------------------------ panel

    function InkPanel(props) {
      const standaloneMode = (() => {
        try {
          if (typeof window === 'undefined') return false
          return new URLSearchParams(window.location.search).get('dsh-ink-window') === '1'
        } catch {
          return false
        }
      })()
      const [standaloneOpen, setStandaloneOpen] = useState(false)
      const standaloneWindowRef = useRef(null)
      const [state, setState] = useState(null)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [current, setCurrent] = useState('')
      const [content, setContent] = useState('')
      const [mtimeMs, setMtimeMs] = useState(0)
      const [dirty, setDirty] = useState(false)
      const [stale, setStale] = useState(false)
      const [issues, setIssues] = useState([])
      const [showIssues, setShowIssues] = useState(true)
      const [busy, setBusy] = useState('')
      const [caret, setCaret] = useState({ line: 1, col: 1, index: 0 })
      const [showBackToTop, setShowBackToTop] = useState(false)
      const [lineKind, setLineKind] = useState('line')
      const [text, setText] = useState('')
      const [openTabs, setOpenTabs] = useState([])
      const [welcomePath, setWelcomePath] = useState('')
      const [recentFiles, setRecentFiles] = useState(() => {
        const stored = readStorage(RECENT_FILES_KEY, [])
        if (!Array.isArray(stored)) return []
        return stored
          .filter(
            (entry) =>
              entry !== null &&
              typeof entry === 'object' &&
              typeof entry.path === 'string' &&
              typeof entry.rootDir === 'string',
          )
          .slice(0, 8)
          .map((entry) => ({
            path: entry.path,
            rootDir: entry.rootDir,
            name: typeof entry.name === 'string' ? entry.name : entry.path.split('/').pop() ?? entry.path,
            mtimeMs: Number(entry.mtimeMs) || 0,
            openedAt: Number(entry.openedAt) || 0,
            preview: typeof entry.preview === 'string' ? entry.preview : '',
          }))
      })
      const [target, setTarget] = useState('')
      const [selected, setSelected] = useState({})
      const [custom, setCustom] = useState({})
      const [customTags, setCustomTags] = useState(() => readStorage(CUSTOM_TAGS_KEY, {}))
      const [customKeys, setCustomKeys] = useState(() => readStorage(CUSTOM_KEYS_KEY, []))
      const [composerPresets, setComposerPresets] = useState(() => {
        const stored = readStorage(COMPOSER_PRESETS_KEY, null)
        if (stored !== null && typeof stored === 'object' && Array.isArray(stored.presets)) {
          const presets = stored.presets
            .filter(
              (preset) =>
                preset !== null &&
                typeof preset === 'object' &&
                typeof preset.id === 'string' &&
                typeof preset.name === 'string',
            )
            .map((preset) => ({
              id: preset.id,
              name: preset.name,
              lineKind: ['line', 'choiceStar', 'choicePlus', 'divert'].includes(preset.lineKind)
                ? preset.lineKind
                : 'line',
              text: typeof preset.text === 'string' ? preset.text : '',
              target: typeof preset.target === 'string' ? preset.target : '',
              selected:
                preset.selected !== null && typeof preset.selected === 'object'
                  ? { ...preset.selected }
                  : {},
              custom:
                preset.custom !== null && typeof preset.custom === 'object'
                  ? { ...preset.custom }
                  : {},
            }))
          if (presets.length > 0) {
            const activeId = presets.some((preset) => preset.id === stored.activeId)
              ? stored.activeId
              : presets[0].id
            return { presets, activeId }
          }
        }
        const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        return {
          presets: [
            {
              id,
              name: `${t('preset')} 1`,
              lineKind: 'line',
              text: '',
              target: '',
              selected: {},
              custom: {},
            },
          ],
          activeId: id,
        }
      })
      const [newKey, setNewKey] = useState('')
      const [zoom, setZoom] = useState(() => {
        const stored = Number(readStorage(ZOOM_KEY, 1))
        return Number.isFinite(stored) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, stored)) : 1
      })
      const [contentWidth, setContentWidth] = useState(600)
      // '' means "use the plugin's configured projectDir"; otherwise a folder
      // the user picked in this panel, remembered across reloads.
      const [rootDir, setRootDir] = useState(() => readStorage(PROJECT_DIR_KEY, ''))
      const [dirEditorOpen, setDirEditorOpen] = useState(false)
      const [dirDraft, setDirDraft] = useState('')
      const [vocabOpen, setVocabOpen] = useState(false)
      const [vocabDrafts, setVocabDrafts] = useState({})
      const [outlineOpen, setOutlineOpen] = useState(false)
      const [outlineLoading, setOutlineLoading] = useState(false)
      const [outlineFiles, setOutlineFiles] = useState([])
      const [outlineError, setOutlineError] = useState('')
      const [outlineNonce, setOutlineNonce] = useState(0)
      const [outlineCollapsed, setOutlineCollapsed] = useState(() => new Set())
      const [pendingJump, setPendingJump] = useState(null)
      const [outlineTruncated, setOutlineTruncated] = useState(false)
      const [outlineSkipped, setOutlineSkipped] = useState(0)
      const [pendingRestore, setPendingRestore] = useState(null)
      const [previewOpen, setPreviewOpen] = useState(() => readStorage(PREVIEW_OPEN_KEY, false) === true)
      const [previewLines, setPreviewLines] = useState([])
      const [previewVariables, setPreviewVariables] = useState([])
      const [previewVariablesOpen, setPreviewVariablesOpen] = useState(true)
      const [previewRevealed, setPreviewRevealed] = useState(0)
      const [previewRevealing, setPreviewRevealing] = useState(false)
      const [previewChoices, setPreviewChoices] = useState([])
      const [previewEnded, setPreviewEnded] = useState(false)
      const [previewError, setPreviewError] = useState('')
      const [previewLoading, setPreviewLoading] = useState(false)
      const [labelMode, setLabelMode] = useState(() =>
        readStorage(LABEL_MODE_KEY, 'both') === 'icons' ? 'icons' : 'both',
      )
      const [railPlacement, setRailPlacement] = useState(() =>
        readStorage(RAIL_PLACEMENT_KEY, 'left') === 'top' ? 'top' : 'left',
      )
      const [railDrop, setRailDrop] = useState(null)
      const [uiColors, setUiColors] = useState(() => {
        const stored = readStorage(UI_COLORS_KEY, null)
        return {
          light: normalizeHex(stored?.light, '#2563eb'),
          dark: normalizeHex(stored?.dark, '#2563eb'),
        }
      })
      const [bandTints, setBandTints] = useState(() => readStorage(BAND_TINTS_KEY, true) !== false)
      const [bandStrength, setBandStrength] = useState(() => {
        const stored = Number(readStorage(BAND_STRENGTH_KEY, 1))
        return Number.isFinite(stored) ? Math.max(0.4, Math.min(2, stored)) : 1
      })
      const [themeDark, setThemeDark] = useState(false)
      const [appearanceOpen, setAppearanceOpen] = useState(false)
      const [uiLang, setUiLang] = useState(() => {
        const stored = readStorage(LANGUAGE_KEY, 'auto')
        return stored === 'zh' || stored === 'en' ? stored : 'auto'
      })
      languageOverride = uiLang
      const [foldedSections, setFoldedSections] = useState(() => new Set())
      const [foldEnabled, setFoldEnabled] = useState(
        () => readStorage(FOLD_ENABLED_KEY, true) !== false,
      )
      const [foldHighlight, setFoldHighlight] = useState(() =>
        normalizeHex(readStorage(FOLD_HIGHLIGHT_KEY, '#f59e0b'), '#f59e0b'),
      )
      const [speakerColors, setSpeakerColors] = useState(() => {
        const stored = readStorage(SPEAKER_COLORS_KEY, null)
        const colors = {}
        if (stored !== null && typeof stored === 'object') {
          for (const [key, value] of Object.entries(stored)) {
            if (typeof value === 'string' && parseHexColor(value) !== null) {
              colors[key] = value.toLowerCase()
            }
          }
        }
        return colors
      })
      const [speakerColorTarget, setSpeakerColorTarget] = useState(null)
      const [interfaceOpen, setInterfaceOpen] = useState(false)
      const [buttonVisibility, setButtonVisibility] = useState(() => {
        const stored = readStorage(BUTTON_VISIBILITY_KEY, null)
        const result = {}
        if (stored !== null && typeof stored === 'object') {
          for (const [key, value] of Object.entries(stored)) {
            if (typeof value === 'boolean') result[key] = value
          }
        }
        return result
      })
      const [blueprintOpen, setBlueprintOpen] = useState(false)
      const [blueprintPositions, setBlueprintPositions] = useState({})
      const [blueprintZoom, setBlueprintZoom] = useState(1)
      const [blueprintSelection, setBlueprintSelection] = useState(() => new Set())
      const [blueprintMarquee, setBlueprintMarquee] = useState(null)
      const [subdir, setSubdir] = useState('')
      const [listing, setListing] = useState(null)
      const [createOpen, setCreateOpen] = useState(false)
      const [createDraft, setCreateDraft] = useState('')
      const [createKind, setCreateKind] = useState('file')
      const [composing, setComposing] = useState(false)
      const [scrollbarWidth, setScrollbarWidth] = useState(0)
      const [completion, setCompletion] = useState(null)
      const [wrapMode, setWrapMode] = useState(() => {
        const stored = readStorage(WRAP_KEY, 'preview')
        return stored === 'auto' ? 'auto' : 'preview'
      })
      const [previewWidth, setPreviewWidth] = useState(300)
      const [wrapInfo, setWrapInfo] = useState({ text: '1', starts: [0], visualLines: 1 })
      const [leftOpen, setLeftOpen] = useState(() => readStorage(LEFT_OPEN_KEY, true) !== false)
      const [rightOpen, setRightOpen] = useState(() => readStorage(RIGHT_OPEN_KEY, true) !== false)
      const [leftWidth, setLeftWidth] = useState(() => {
        const value = Number(readStorage(LEFT_WIDTH_KEY, 220))
        return Number.isFinite(value) ? Math.max(150, Math.min(420, value)) : 220
      })
      const [rightWidth, setRightWidth] = useState(() => {
        const value = Number(readStorage(RIGHT_WIDTH_KEY, 300))
        return Number.isFinite(value) ? Math.max(220, Math.min(560, value)) : 300
      })

      const taRef = useRef(null)
      const gutterRef = useRef(null)
      const highlightRef = useRef(null)
      const completionListRef = useRef(null)
      const previewRef = useRef(null)
      const mirrorRef = useRef(null)
      const blueprintCanvasRef = useRef(null)
      const blueprintZoomRef = useRef(1)
      const rootRef = useRef(null)
      const measureRef = useRef(null)
      const noticeTimer = useRef(0)
      const outlineInitialCollapse = useRef(false)
      const lastAccept = useRef(0)
      const completionRef = useRef(null)
      const previewSession = useRef('')
      const previewSeq = useRef(0)
      const previewBodyRef = useRef(null)
      const previewRevealTimer = useRef(0)
      const previewRevealedRef = useRef(0)
      const previewLineId = useRef(0)
      const bandScrollRef = useRef(null)
      const foldMarkerScrollRef = useRef(null)
      const buffersRef = useRef(new Map())
      const skipStashRef = useRef(false)
      const pendingScrollRef = useRef(null)
      const pendingCaretRef = useRef(null)
      const activeFileRef = useRef(null)
      const rootDirRef = useRef(rootDir)
      rootDirRef.current = rootDir
      blueprintZoomRef.current = blueprintZoom
      const live = useRef({})
      live.current = { current, dirty, mtimeMs, content, subdir }
      completionRef.current = completion

      // ------------------------------------------------------------- undo/redo
      const undoStack = useRef([])
      const redoStack = useRef([])
      const lastEdit = useRef({ at: 0, kind: '' })
      const backupState = useRef({ path: '', content: '', inFlight: false })

      function resetHistory() {
        undoStack.current = []
        redoStack.current = []
        lastEdit.current = { at: 0, kind: '' }
      }

      function pushHistory(kind) {
        const now = Date.now()
        const previous = lastEdit.current
        if (kind === 'type' && previous.kind === 'type' && now - previous.at < 900) {
          lastEdit.current = { at: now, kind }
          return
        }
        const top = undoStack.current[undoStack.current.length - 1]
        if (top === undefined || top.content !== content) {
          undoStack.current.push({ content, index: caret.index })
          if (undoStack.current.length > 100) undoStack.current.shift()
        }
        redoStack.current = []
        lastEdit.current = { at: now, kind }
      }

      function restoreSnapshot(entry) {
        setContent(entry.content)
        setDirty(true)
        closeCompletion()
        const position = Math.max(0, Math.min(entry.index ?? entry.content.length, entry.content.length))
        requestAnimationFrame(() => {
          const textarea = taRef.current
          if (textarea !== null) {
            textarea.focus()
            textarea.setSelectionRange(position, position)
          }
          updateCaret(position)
        })
      }

      function undo() {
        const stack = undoStack.current
        if (stack.length === 0) return
        if (foldedSections.size > 0) setFoldedSections(new Set())
        const entry = stack.pop()
        redoStack.current.push({ content, index: caret.index })
        lastEdit.current = { at: 0, kind: '' }
        restoreSnapshot(entry)
      }

      function redo() {
        const stack = redoStack.current
        if (stack.length === 0) return
        if (foldedSections.size > 0) setFoldedSections(new Set())
        const entry = stack.pop()
        undoStack.current.push({ content, index: caret.index })
        if (undoStack.current.length > 100) undoStack.current.shift()
        lastEdit.current = { at: 0, kind: '' }
        restoreSnapshot(entry)
      }

      // ------------------------------------------------------------ autosave
      async function saveBackupNow() {
        const snapshot = live.current
        if (!snapshot.current || !snapshot.dirty || snapshot.content === '') return
        const state = backupState.current
        if (state.inFlight) return
        if (state.path === snapshot.current && state.content === snapshot.content) return
        const query = projectQuery({ path: snapshot.current })
        const dir = dirField()
        state.inFlight = true
        try {
          const response = await fetch(API + '/backup' + query, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              path: snapshot.current,
              content: snapshot.content,
              dir,
            }),
          })
          if (response.ok) {
            const now = live.current
            if (now.dirty && now.current === snapshot.current && now.content === snapshot.content) {
              state.path = snapshot.current
              state.content = snapshot.content
            } else {
              // The editor moved on (or was saved) while the copy was being
              // written; remove the now-stale copy instead of resurrecting it.
              void fetch(API + '/backup' + query, { method: 'DELETE' }).catch(() => {})
              if (state.path === snapshot.current) {
                state.path = ''
                state.content = ''
              }
            }
          }
        } catch {
          // a failed backup must never disturb editing
        } finally {
          state.inFlight = false
        }
      }

      function deleteBackup(path) {
        if (!path) return
        backupState.current = { path: '', content: '', inFlight: false }
        void request('/backup' + projectQuery({ path }), { method: 'DELETE' }).catch(() => {})
      }

      async function checkBackupForFile(path, fileContent, fileMtime) {
        if (!path) return
        const result = await request('/backup' + projectQuery({ path }))
        if (result.status !== 200) return
        const backup = result.body
        if (typeof backup.content !== 'string' || typeof backup.savedAt !== 'number') return
        if (backup.content === fileContent) {
          // Nothing to recover; keep the copy untouched (the editor may still
          // hold it unsaved).
          return
        }
        if (backup.savedAt > fileMtime) {
          setPendingRestore({ path, content: backup.content, savedAt: backup.savedAt })
        } else {
          deleteBackup(path)
        }
      }

      async function checkBackupForCurrent() {
        const snapshot = live.current
        if (!snapshot.current || snapshot.dirty) return
        await checkBackupForFile(snapshot.current, snapshot.content, snapshot.mtimeMs)
      }

      function restoreBackup() {
        if (pendingRestore === null) return
        const backup = pendingRestore
        setPendingRestore(null)
        pushHistory('action')
        setContent(backup.content)
        setDirty(true)
        deleteBackup(backup.path)
        const position = backup.content.length
        requestAnimationFrame(() => {
          const textarea = taRef.current
          if (textarea !== null) {
            textarea.focus()
            textarea.setSelectionRange(position, position)
          }
          updateCaret(position)
        })
      }

      function discardRestore() {
        if (pendingRestore === null) return
        const path = pendingRestore.path
        setPendingRestore(null)
        deleteBackup(path)
      }

      // -------------------------------------------------------------- preview
      function stopPreviewSession(id) {
        if (!id) return
        void postJson('/preview', { action: 'stop', id }).catch(() => {})
      }

      function stopPreview() {
        const id = previewSession.current
        previewSession.current = ''
        stopPreviewSession(id)
      }

      function scrollPreviewToEnd() {
        requestAnimationFrame(() => {
          const body = previewBodyRef.current
          if (body !== null) body.scrollTop = body.scrollHeight
        })
      }

      function clearPreviewReveal() {
        window.clearTimeout(previewRevealTimer.current)
        previewRevealTimer.current = 0
      }

      function resetPreviewTranscript() {
        clearPreviewReveal()
        previewRevealedRef.current = 0
        setPreviewLines([])
        setPreviewVariables([])
        setPreviewRevealed(0)
        setPreviewRevealing(false)
        setPreviewChoices([])
        setPreviewEnded(false)
      }

      function previewLineEntries(lines, variableChanges) {
        const byLine = new Map()
        for (const record of Array.isArray(variableChanges) ? variableChanges : []) {
          const lineIndex = Number(record?.line)
          if (!Number.isInteger(lineIndex)) continue
          const changes = Array.isArray(record.changes) ? record.changes : []
          if (changes.length === 0) continue
          const existing = byLine.get(lineIndex) ?? []
          byLine.set(lineIndex, [...existing, ...changes])
        }
        const entries = []
        lines.forEach((text, index) => {
          previewLineId.current += 1
          entries.push({
            id: `line-${previewLineId.current}`,
            kind: 'line',
            text: String(text ?? ''),
          })
          for (const change of byLine.get(index) ?? []) {
            previewLineId.current += 1
            const scopeLabel =
              change.scope === 'global' ? t('variableGlobal') : t('variableCurrent')
            entries.push({
              id: `var-${previewLineId.current}`,
              kind: 'variable',
              scope: change.scope,
              text: `${scopeLabel} ${change.name} = ${change.value}`,
            })
          }
        })
        return entries
      }

      function beginPreviewReveal(total, choices, ended) {
        clearPreviewReveal()
        setPreviewChoices([])
        setPreviewEnded(false)
        setPreviewRevealing(true)
        let index = previewRevealedRef.current
        const finish = () => {
          setPreviewRevealing(false)
          setPreviewChoices(Array.isArray(choices) ? choices : [])
          setPreviewEnded(ended === true)
          scrollPreviewToEnd()
        }
        const tick = () => {
          if (index >= total) {
            finish()
            return
          }
          index += 1
          previewRevealedRef.current = index
          setPreviewRevealed(index)
          scrollPreviewToEnd()
          if (index >= total) {
            previewRevealTimer.current = window.setTimeout(finish, 240)
          } else {
            previewRevealTimer.current = window.setTimeout(tick, 300)
          }
        }
        previewRevealTimer.current = window.setTimeout(tick, 140)
      }

      async function startPreview() {
        if (!current) return
        const seq = previewSeq.current + 1
        previewSeq.current = seq
        stopPreview()
        resetPreviewTranscript()
        setPreviewLoading(true)
        setPreviewError('')
        const result = await postJson('/preview', {
          action: 'start',
          path: current,
          content,
          dir: dirField(),
        })
        if (previewSeq.current !== seq) {
          if (result.body?.id) stopPreviewSession(result.body.id)
          return
        }
        setPreviewLoading(false)
        if (result.status !== 200) {
          setPreviewError(result.body?.message || t('previewFailed'))
          return
        }
        if (result.body?.ok !== true) {
          const errors = Array.isArray(result.body?.errors) ? result.body.errors : []
          setPreviewError(
            errors.length > 0 ? errors.join('\n') : result.body?.message || t('previewFailed'),
          )
          return
        }
        previewSession.current = String(result.body.id ?? '')
        const sourceLines = Array.isArray(result.body.lines)
          ? result.body.lines
          : result.body.text
            ? [result.body.text]
            : []
        const entries = previewLineEntries(sourceLines, result.body.variableChanges)
        previewRevealedRef.current = 0
        setPreviewLines(entries)
        setPreviewVariables(
          Array.isArray(result.body.variables) ? result.body.variables : [],
        )
        setPreviewRevealed(0)
        beginPreviewReveal(entries.length, result.body.choices, result.body.ended)
      }

      async function choosePreview(index) {
        const id = previewSession.current
        if (!id) return
        setPreviewLoading(true)
        setPreviewChoices([])
        setPreviewEnded(false)
        const result = await postJson('/preview', { action: 'choose', id, index })
        setPreviewLoading(false)
        if (result.status === 404) {
          void startPreview()
          return
        }
        if (result.status !== 200 || result.body?.ok !== true) {
          setPreviewError(result.body?.message || t('previewFailed'))
          return
        }
        setPreviewError('')
        const sourceLines = Array.isArray(result.body.lines)
          ? result.body.lines
          : result.body.text
            ? [result.body.text]
            : []
        const entries = previewLineEntries(sourceLines, result.body.variableChanges)
        setPreviewLines((previous) => [...previous, ...entries])
        setPreviewVariables(
          Array.isArray(result.body.variables) ? result.body.variables : [],
        )
        beginPreviewReveal(
          previewRevealedRef.current + entries.length,
          result.body.choices,
          result.body.ended,
        )
      }

      function togglePreview() {
        const next = !previewOpen
        setPreviewOpen(next)
        writeStorage(PREVIEW_OPEN_KEY, next)
      }

      function closePreview() {
        setPreviewOpen(false)
        writeStorage(PREVIEW_OPEN_KEY, false)
      }

      function setLabelModeAndStore(next) {
        const value = next === 'icons' ? 'icons' : 'both'
        setLabelMode(value)
        writeStorage(LABEL_MODE_KEY, value)
      }

      function setButtonVisible(key, visible) {
        const next = { ...buttonVisibility, [key]: visible }
        setButtonVisibility(next)
        writeStorage(BUTTON_VISIBILITY_KEY, next)
      }

      function setAllButtonsVisible(visible) {
        const next = {}
        for (const item of ACTION_BUTTONS) next[item.key] = visible
        setButtonVisibility(next)
        writeStorage(BUTTON_VISIBILITY_KEY, next)
      }

      function resetButtonVisibility() {
        setButtonVisibility({})
        writeStorage(BUTTON_VISIBILITY_KEY, {})
      }

      function setBandTintsAndStore(next) {
        setBandTints(next)
        writeStorage(BAND_TINTS_KEY, next)
      }

      function setUiLangAndStore(next) {
        const value = next === 'zh' || next === 'en' ? next : 'auto'
        setUiLang(value)
        languageOverride = value
        writeStorage(LANGUAGE_KEY, value)
      }

      function setFoldEnabledAndStore(next) {
        setFoldEnabled(next)
        writeStorage(FOLD_ENABLED_KEY, next)
        if (!next) setFoldedSections(new Set())
      }

      function setBandStrengthAndStore(next) {
        const value = Math.max(0.4, Math.min(2, Number(next) || 1))
        setBandStrength(value)
        writeStorage(BAND_STRENGTH_KEY, value)
      }

      function setFoldHighlightAndStore(value) {
        const next = normalizeHex(value, '#f59e0b')
        setFoldHighlight(next)
        writeStorage(FOLD_HIGHLIGHT_KEY, next)
      }

      function setSpeakerColorAndStore(speaker, value) {
        const next = normalizeHex(value, speakerDefaultHex(speaker))
        const colors = { ...speakerColors, [speaker]: next }
        setSpeakerColors(colors)
        writeStorage(SPEAKER_COLORS_KEY, colors)
      }

      function resetSpeakerColor(speaker) {
        const colors = { ...speakerColors }
        delete colors[speaker]
        setSpeakerColors(colors)
        writeStorage(SPEAKER_COLORS_KEY, colors)
      }

      function updateUiColor(theme, value) {
        const next = { ...uiColors, [theme]: normalizeHex(value, uiColors[theme]) }
        setUiColors(next)
        writeStorage(UI_COLORS_KEY, next)
      }

      function resetAppearance() {
        const next = { light: '#2563eb', dark: '#2563eb' }
        setUiColors(next)
        writeStorage(UI_COLORS_KEY, next)
        setBandTintsAndStore(true)
        setBandStrengthAndStore(1)
        setFoldHighlightAndStore('#f59e0b')
      }

      function toggleFoldSection(line) {
        closeCompletion()
        setFoldedSections((previous) => {
          const next = new Set(previous)
          if (next.has(line)) next.delete(line)
          else next.add(line)
          return next
        })
      }

      function handleFoldedChange(event) {
        const target = event.target
        const nextView = target.value
        if (nextView === viewContent) return
        let start = 0
        while (
          start < viewContent.length &&
          start < nextView.length &&
          viewContent[start] === nextView[start]
        ) {
          start += 1
        }
        let endOld = viewContent.length
        let endNew = nextView.length
        while (
          endOld > start &&
          endNew > start &&
          viewContent[endOld - 1] === nextView[endNew - 1]
        ) {
          endOld -= 1
          endNew -= 1
        }
        const removed = viewContent.slice(start, endOld)
        const inserted = nextView.slice(start, endNew)
        const newlineCount = (text) => (text.match(/\n/g) ?? []).length
        const newlineDelta = newlineCount(inserted) - newlineCount(removed)
        const reset = (messageKey) => {
          flash(t(messageKey))
          target.value = viewContent
          const position = Math.min(start, viewContent.length)
          target.setSelectionRange(position, position)
          updateCaret(position)
        }
        const lines = content.split('\n')
        const contentStarts = []
        let offset = 0
        for (const line of lines) {
          contentStarts.push(offset)
          offset += line.length + 1
        }
        const runs = []
        let viewPos = 0
        let previous = -2
        for (const index of foldView.visible) {
          const text = lines[index]
          const viewStart = viewPos
          const viewEnd = viewPos + text.length
          const contentStart = contentStarts[index]
          const contentEnd = contentStart + text.length
          if (index === previous + 1 && runs.length > 0) {
            const last = runs[runs.length - 1]
            last.viewEnd = viewEnd
            last.contentEnd = contentEnd
          } else {
            runs.push({ viewStart, viewEnd, contentStart, contentEnd })
          }
          previous = index
          viewPos = viewEnd + 1
        }
        let contentStart = -1
        let contentEnd = -1
        if (start === endOld) {
          const run = runs.find(
            (entry) => start >= entry.viewStart && start <= entry.viewEnd,
          )
          if (run === undefined) {
            reset('foldNoCross')
            return
          }
          contentStart = run.contentStart + (start - run.viewStart)
          contentEnd = contentStart
        } else {
          const run = runs.find(
            (entry) => start >= entry.viewStart && endOld <= entry.viewEnd,
          )
          if (run === undefined) {
            reset('foldNoCross')
            return
          }
          contentStart = run.contentStart + (start - run.viewStart)
          contentEnd = run.contentStart + (endOld - run.viewStart)
        }
        const nextContent =
          content.slice(0, contentStart) + inserted + content.slice(contentEnd)
        if (newlineDelta !== 0) {
          setFoldedSections((previous) => {
            const next = new Set()
            for (const line of previous) {
              const offset = contentStarts[line - 1]
              let nextLine = line
              if (offset === contentStart) {
                if (removed.length === 0) nextLine = line + newlineCount(inserted)
              } else if (offset >= contentEnd) {
                nextLine = line + newlineDelta
              }
              next.add(Math.max(1, nextLine))
            }
            return next
          })
        }
        pushHistory('type')
        setContent(nextContent)
        setDirty(true)
        if (!event.nativeEvent?.isComposing) {
          const caret = start + inserted.length
          requestAnimationFrame(() => {
            const element = taRef.current
            if (element !== null) element.setSelectionRange(caret, caret)
            updateCaret(caret)
          })
        }
      }

      function setRailPlacementAndStore(next) {
        setRailPlacement(next)
        writeStorage(RAIL_PLACEMENT_KEY, next)
      }

      function startRailDrag(event) {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        const root = rootRef.current
        if (root === null) return
        const startX = event.clientX
        const startY = event.clientY
        let moved = false
        let target = null
        const computeTarget = (clientX, clientY) => {
          const rect = root.getBoundingClientRect()
          const x = clientX - rect.left
          const y = clientY - rect.top
          if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null
          if (x < 120 && y < 90) return y < x ? 'top' : 'left'
          if (y < 90) return 'top'
          if (x < 120) return 'left'
          return null
        }
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'grabbing'
        const onMove = (moveEvent) => {
          if (
            Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) >
            4
          ) {
            moved = true
          }
          target = computeTarget(moveEvent.clientX, moveEvent.clientY)
          setRailDrop(target)
        }
        const onUp = () => {
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
          document.body.style.userSelect = ''
          document.body.style.cursor = ''
          setRailDrop(null)
          if (!moved) {
            setRailPlacementAndStore(railPlacement === 'left' ? 'top' : 'left')
            return
          }
          if (target !== null) setRailPlacementAndStore(target)
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      }

      /** Attach the chosen project root to a request (query or JSON field). */
      function projectQuery(extra) {
        const params = new URLSearchParams(extra ?? undefined)
        if (rootDirRef.current !== '') params.set('dir', rootDirRef.current)
        const text = params.toString()
        return text === '' ? '' : `?${text}`
      }

      function dirField() {
        return rootDirRef.current === '' ? undefined : rootDirRef.current
      }

      const fontSize = Math.max(10, Math.round(13 * zoom))
      const lineHeight = Math.max(16, Math.round(20 * zoom))
      const gutterWidth = Math.max(46, Math.round(fontSize * 3.3))
      // "Same as preview" makes the editor wrap at the preview's text width,
      // so a line that the preview breaks into several rows looks the same
      // while editing — without writing any newline into the file.
      const previewTextWidth = Math.max(140, previewWidth - 16)
      const wrapMaxWidth =
        wrapMode === 'preview' && rightOpen
          ? previewTextWidth + gutterWidth + 20 + scrollbarWidth
          : undefined

      function toggleLeft() {
        const next = !leftOpen
        setLeftOpen(next)
        writeStorage(LEFT_OPEN_KEY, next)
      }

      function toggleRight() {
        const next = !rightOpen
        setRightOpen(next)
        writeStorage(RIGHT_OPEN_KEY, next)
      }

      function resizeBound(side, value) {
        const min = side === 'left' ? 150 : 220
        const max =
          side === 'left'
            ? Math.min(420, Math.max(180, window.innerWidth * 0.4))
            : Math.min(560, Math.max(240, window.innerWidth * 0.45))
        return Math.max(min, Math.min(max, Math.round(value)))
      }

      function startResize(side, event) {
        event.preventDefault()
        const startX = event.clientX
        const wasOpen = side === 'left' ? leftOpen : rightOpen
        const startWidth = wasOpen ? (side === 'left' ? leftWidth : rightWidth) : 0
        const collapseAt = side === 'left' ? 150 : 220
        const openKey = side === 'left' ? LEFT_OPEN_KEY : RIGHT_OPEN_KEY
        const widthKey = side === 'left' ? LEFT_WIDTH_KEY : RIGHT_WIDTH_KEY
        const setOpen = side === 'left' ? setLeftOpen : setRightOpen
        const setWidth = side === 'left' ? setLeftWidth : setRightWidth
        let open = wasOpen
        let lastWidth = startWidth
        const persistOpen = (next) => {
          writeStorage(openKey, next)
        }
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'col-resize'
        const onMove = (moveEvent) => {
          const delta = moveEvent.clientX - startX
          const raw = side === 'left' ? startWidth + delta : startWidth - delta
          if (raw <= collapseAt) {
            if (open) {
              open = false
              setOpen(false)
              persistOpen(false)
              // Keep the pre-drag width so re-expanding feels normal.
              setWidth(startWidth)
              lastWidth = startWidth
              writeStorage(widthKey, startWidth)
            }
            return
          }
          if (!open) {
            open = true
            setOpen(true)
            persistOpen(true)
          }
          const bounded = resizeBound(side, raw)
          lastWidth = bounded
          setWidth(bounded)
        }
        const onUp = () => {
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
          document.body.style.userSelect = ''
          document.body.style.cursor = ''
          if (open) writeStorage(widthKey, lastWidth)
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      }

      function resetWidth(side) {
        const value = side === 'left' ? 220 : 300
        if (side === 'left') setLeftWidth(value)
        else setRightWidth(value)
        writeStorage(side === 'left' ? LEFT_WIDTH_KEY : RIGHT_WIDTH_KEY, value)
      }

      function changeZoom(delta) {
        setZoom((previous) => {
          const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((previous + delta) * 10) / 10))
          writeStorage(ZOOM_KEY, next)
          return next
        })
      }

      function resetZoom() {
        setZoom(1)
        writeStorage(ZOOM_KEY, 1)
      }

      const flash = (message) => {
        setNotice(message)
        if (noticeTimer.current !== 0) clearTimeout(noticeTimer.current)
        noticeTimer.current = setTimeout(() => {
          noticeTimer.current = 0
          setNotice('')
        }, 3500)
      }

      const vocab = state?.vocab ?? {}
      const tagKeys = useMemo(() => {
        const keys = new Set(DEFAULT_KEYS)
        for (const key of Object.keys(vocab)) keys.add(key)
        for (const key of customKeys) keys.add(key)
        const ordered = DEFAULT_KEYS.filter((key) => keys.has(key))
        const rest = [...keys].filter((key) => !DEFAULT_KEYS.includes(key)).sort((a, b) => a.localeCompare(b, 'zh'))
        return [...ordered, ...rest]
      }, [state, customKeys])

      // Symbols in the open file, used as autocomplete candidates.
      const inkSymbols = useMemo(() => {
        const knots = new Set()
        const stitches = new Set()
        const functions = new Set()
        const variables = new Set()
        for (const line of content.split('\n')) {
          let match = /^\s*={2,}\s*function\s+([A-Za-z0-9_\u4e00-\u9fff]+)/.exec(line)
          if (match !== null) {
            functions.add(match[1])
            continue
          }
          match = /^\s*={2,}\s*([A-Za-z0-9_\u4e00-\u9fff]+)/.exec(line)
          if (match !== null) {
            knots.add(match[1])
            continue
          }
          match = /^\s*=\s*([A-Za-z0-9_\u4e00-\u9fff]+)/.exec(line)
          if (match !== null) {
            stitches.add(match[1])
            continue
          }
          match = /^\s*(?:VAR|CONST|LIST)\s+([A-Za-z0-9_\u4e00-\u9fff]+)/.exec(line)
          if (match !== null) {
            variables.add(match[1])
            continue
          }
          match = /^\s*~\s*(?:temp\s+)?([A-Za-z0-9_\u4e00-\u9fff]+)\s*=/.exec(line)
          if (match !== null) variables.add(match[1])
        }
        return {
          knots: [...knots],
          stitches: [...stitches],
          functions: [...functions],
          variables: [...variables],
        }
      }, [content])

      // ------------------------------------------------------------- loading

      async function loadListing(path, quiet) {
        if (quiet !== true) setBusy('browse')
        const result = await request('/browse' + projectQuery({ path }))
        if (quiet !== true) setBusy('')
        if (result.status !== 200) {
          if (quiet !== true) setError(result.body.message || t('readFailed'))
          return null
        }
        setListing(result.body)
        setSubdir(result.body.path ?? '')
        return result.body
      }

      async function goTo(path) {
        await loadListing(path)
      }

      async function refreshState(initial) {
        const result = await request('/state' + projectQuery())
        if (result.status !== 200) {
          setError(result.body.message || t('readFailed'))
          return
        }
        setState(result.body)
        setError('')
        if (initial) {
          const listingBody = await loadListing('')
          const remembered = readStorage(LAST_FILE_KEY, '')
          const rootFiles = listingBody?.files ?? []
          const allFiles = result.body.files ?? []
          const pick =
            allFiles.find((file) => file.path === remembered) ??
            rootFiles[0] ??
            allFiles[0]
          if (pick !== undefined) await openFile(pick.path, true)
        }
      }

      async function refreshProject() {
        setBusy('refresh')
        const result = await request('/state' + projectQuery())
        if (result.status === 200) {
          setState(result.body)
          setError('')
        } else {
          setError(result.body.message || t('readFailed'))
        }
        await loadListing(live.current.subdir, true)
        setBusy('')
        flash(result.status === 200 ? t('refreshed') : t('readFailed'))
      }

      async function switchRoot(next) {
        if (next === rootDirRef.current) {
          setDirEditorOpen(false)
          return
        }
        const anyDirty =
          dirty || [...buffersRef.current.values()].some((buffer) => buffer.dirty === true)
        if (anyDirty && !window.confirm(t('discardPrompt'))) return
        setBusy('dir')
        // Probe the folder first: a bad path must not clear the open buffer.
        const probe = await request('/state' + queryForDir(next))
        setBusy('')
        if (probe.status !== 200) {
          setError(probe.body.message || t('readFailed'))
          return
        }
        rootDirRef.current = next
        setRootDir(next)
        if (next === '') {
          try {
            localStorage.removeItem(PROJECT_DIR_KEY)
          } catch {
            // a blocked storage only costs the remembered folder
          }
        } else {
          writeStorage(PROJECT_DIR_KEY, next)
        }
        if (anyDirty) void saveBackupNow()
        setPendingRestore(null)
        setOpenTabs([])
        buffersRef.current.clear()
        setCurrent('')
        setContent('')
        resetHistory()
        setDirty(false)
        setMtimeMs(0)
        setStale(false)
        setIssues([])
        setState(probe.body)
        setError('')
        setDirEditorOpen(false)
        setSubdir('')
        setListing(null)
        const listingBody = await loadListing('')
        const pick = listingBody?.files?.[0] ?? (probe.body.files ?? [])[0]
        if (pick !== undefined) await openFile(pick.path, true)
      }

      function queryForDir(next) {
        const params = new URLSearchParams()
        if (typeof next === 'string' && next !== '') params.set('dir', next)
        const text = params.toString()
        return text === '' ? '' : `?${text}`
      }

      function openDirEditor() {
        setDirDraft(state?.projectDir ?? rootDirRef.current)
        setDirEditorOpen(true)
        setError('')
      }

      async function submitDir() {
        const next = dirDraft.trim()
        if (next === '') {
          setError(t('switchDirEmpty'))
          return
        }
        await switchRoot(next)
      }

      async function browseForDir() {
        if (props === null || props === undefined || typeof props.pickDirectory !== 'function') {
          flash(t('pickerUnavailable'))
          return
        }
        try {
          const picked = await props.pickDirectory()
          if (picked !== null && picked !== undefined && picked !== '') setDirDraft(picked)
        } catch {
          flash(t('pickerUnavailable'))
        }
      }

      function stashCurrentBuffer() {
        if (current === '') return
        const element = taRef.current
        buffersRef.current.set(current, {
          content,
          dirty,
          mtimeMs,
          caret: caret.index,
          scrollTop: element === null ? 0 : element.scrollTop,
          undo: undoStack.current.slice(),
          redo: redoStack.current.slice(),
          lastEdit: { ...lastEdit.current },
        })
      }

      function rememberRecentFile(path, fileContent, fileMtime) {
        const root = rootDirRef.current || state?.projectDir || ''
        const name = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path
        const preview = fileContent
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 3)
          .join('\n')
          .slice(0, 180)
        const entry = { path, rootDir: root, name, mtimeMs: fileMtime, openedAt: Date.now(), preview }
        setRecentFiles((previous) => {
          const next = [
            entry,
            ...previous.filter((item) => !(item.path === path && item.rootDir === root)),
          ].slice(0, 8)
          writeStorage(RECENT_FILES_KEY, next)
          return next
        })
      }

      function restoreBuffer(path, buffer) {
        setCurrent(path)
        setContent(buffer.content)
        setDirty(buffer.dirty === true)
        setMtimeMs(buffer.mtimeMs ?? 0)
        setStale(false)
        setError('')
        setPendingRestore(null)
        setIssues([])
        undoStack.current = Array.isArray(buffer.undo) ? buffer.undo.slice() : []
        redoStack.current = Array.isArray(buffer.redo) ? buffer.redo.slice() : []
        lastEdit.current = { ...(buffer.lastEdit ?? { at: 0, kind: '' }) }
        pendingScrollRef.current = buffer.scrollTop ?? 0
        pendingCaretRef.current = buffer.caret ?? 0
        const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
        if (dir !== live.current.subdir) void loadListing(dir, true)
        writeStorage(LAST_FILE_KEY, path)
      }

      function normalizeOpenedPath(value) {
        const root = (rootDirRef.current || state?.projectDir || '').replace(/\\/g, '/')
        let path = value.replace(/\\/g, '/').trim()
        if (root !== '' && path.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
          path = path.slice(root.length + 1)
        }
        return path.replace(/^\/+/, '')
      }

      async function openWelcomePath() {
        const value = welcomePath.trim()
        if (value === '') return
        const normalized = value.replace(/\\/g, '/')
        if (normalized.toLowerCase().endsWith('.ink')) {
          await openFile(normalizeOpenedPath(value), false)
        } else {
          await switchRoot(value)
        }
      }

      async function pickWelcomeFolder() {
        if (props === null || props === undefined || typeof props.pickDirectory !== 'function') {
          flash(t('pickerUnavailable'))
          return
        }
        try {
          const picked = await props.pickDirectory()
          if (picked !== null && picked !== undefined && picked !== '') await switchRoot(picked)
        } catch {
          flash(t('pickerUnavailable'))
        }
      }

      async function openFile(path, force) {
        if (!path) return false
        if (path === current && force !== true) return true
        if (force === true && path === current && dirty && !window.confirm(t('discardPrompt'))) return false
        if (path !== current && dirty && current !== '') void saveBackupNow()
        const cached = buffersRef.current.get(path)
        if (force !== true && cached !== undefined && path !== current) {
          stashCurrentBuffer()
          setPendingRestore(null)
          restoreBuffer(path, cached)
          setOpenTabs((previous) => (previous.includes(path) ? previous : [...previous, path]))
          return true
        }
        if (!skipStashRef.current) stashCurrentBuffer()
        skipStashRef.current = false
        setPendingRestore(null)
        setBusy('open')
        const result = await request(`/file${projectQuery({ path })}`)
        setBusy('')
        if (result.status !== 200) {
          setError(result.body.message || t('readFailed'))
          return false
        }
        const loadedContent = result.body.content ?? ''
        const loadedMtime = Number(result.body.mtimeMs) || 0
        buffersRef.current.set(path, {
          content: loadedContent,
          dirty: false,
          mtimeMs: loadedMtime,
          caret: 0,
          scrollTop: 0,
          undo: [],
          redo: [],
          lastEdit: { at: 0, kind: '' },
        })
        pendingScrollRef.current = null
        pendingCaretRef.current = null
        setCurrent(path)
        setContent(loadedContent)
        resetHistory()
        setMtimeMs(loadedMtime)
        setDirty(false)
        setStale(false)
        setError('')
        setIssues([])
        setOpenTabs((previous) => (previous.includes(path) ? previous : [...previous, path]))
        writeStorage(LAST_FILE_KEY, path)
        const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
        if (dir !== live.current.subdir) void loadListing(dir, true)
        rememberRecentFile(path, loadedContent, loadedMtime)
        void checkBackupForFile(path, loadedContent, loadedMtime)
        return true
      }

      // -------------------------------------------------------------- saving

      async function closeTab(path) {
        const bufferDirty =
          path === current ? dirty : buffersRef.current.get(path)?.dirty === true
        if (bufferDirty && !window.confirm(t('closeDirtyTab'))) return
        void deleteBackup(path)
        const remaining = openTabs.filter((tab) => tab !== path)
        buffersRef.current.delete(path)
        setOpenTabs(remaining)
        if (path !== current) return
        if (remaining.length === 0) {
          setCurrent('')
          setContent('')
          setDirty(false)
          setMtimeMs(0)
          setStale(false)
          setIssues([])
          setError('')
          resetHistory()
          setFoldedSections(new Set())
          return
        }
        const index = openTabs.indexOf(path)
        const nextPath =
          remaining[Math.min(Math.max(index, 0), remaining.length - 1)] ?? remaining[0]
        const nextBuffer = buffersRef.current.get(nextPath)
        if (nextBuffer !== undefined) {
          restoreBuffer(nextPath, nextBuffer)
        } else {
          skipStashRef.current = true
          await openFile(nextPath)
        }
      }

      async function save(force) {
        if (!current) return
        setBusy('save')
        const result = await postJson('/file', {
          path: current,
          content,
          baseMtimeMs: force === true ? 0 : mtimeMs,
          dir: dirField(),
        })
        setBusy('')
        if (result.status === 200) {
          const savedMtime = Number(result.body.mtimeMs) || 0
          setMtimeMs(savedMtime)
          setDirty(false)
          setStale(false)
          setPendingRestore(null)
          deleteBackup(current)
          buffersRef.current.set(current, {
            content,
            dirty: false,
            mtimeMs: savedMtime,
            caret: caret.index,
            scrollTop: taRef.current === null ? 0 : taRef.current.scrollTop,
            undo: undoStack.current.slice(),
            redo: redoStack.current.slice(),
            lastEdit: { ...lastEdit.current },
          })
          rememberRecentFile(current, content, savedMtime)
          flash(t('savedToDisk'))
          // Refresh the file list and the tag vocabulary without touching the
          // open buffer: the just-saved line may have added new #key values.
          void refreshState(false)
          return true
        }
        if (result.status === 409) {
          setStale(true)
          flash(t('conflict'))
          return false
        }
        setError(result.body.message || t('writeFailed'))
        return false
      }

      async function check() {
        if (!current) return
        setBusy('lint')
        const result = await postJson('/lint', { path: current, content, dir: dirField() })
        setBusy('')
        if (result.status !== 200) {
          setError(result.body.message || t('lintFailed'))
          return
        }
        const next = Array.isArray(result.body.issues) ? result.body.issues : []
        setIssues(next)
        setShowIssues(true)
        flash(next.length === 0 ? t('noIssues') : `${next.length} ${t('issues')}`)
      }

      function toggleStandaloneWindow() {
        const existing = standaloneWindowRef.current
        if (existing !== null && !existing.closed) {
          existing.close()
          standaloneWindowRef.current = null
          setStandaloneOpen(false)
          return
        }
        void (async () => {
          let url = ''
          try {
            const target = new URL(window.location.href)
            target.searchParams.set('dsh-ink-window', '1')
            url = target.toString()
          } catch {
            flash(t('popupBlocked'))
            return
          }
          try {
            const result = await postJson('/window', { url })
            if (
              result.status === 200 &&
              result.body?.ok === true &&
              result.body?.mode === 'electron'
            ) {
              setStandaloneOpen(result.body.open === true)
              return
            }
          } catch {
            // Older host or DSH Web: fall through to a browser popup.
          }
          try {
            const win = window.open(
              url,
              'dsh-ink-window',
              'popup=yes,width=1280,height=900',
            )
            if (win === null) {
              flash(t('popupBlocked'))
              return
            }
            standaloneWindowRef.current = win
            setStandaloneOpen(true)
            win.focus()
          } catch {
            flash(t('popupBlocked'))
          }
        })()
      }

      function openCreate() {
        setCreateDraft('')
        setCreateKind('file')
        setCreateOpen(true)
      }

      async function submitCreate() {
        const trimmed = createDraft.trim()
        if (trimmed === '') return
        const targetPath = subdir === '' ? trimmed : `${subdir}/${trimmed}`
        const result = await postJson('/new', {
          name: targetPath,
          dir: dirField(),
          kind: createKind,
        })
        if (result.status === 200) {
          setCreateOpen(false)
          setCreateDraft('')
          await refreshState(false)
          await loadListing(subdir)
          if (createKind === 'folder') {
            await goTo(result.body.path)
          } else {
            await openFile(result.body.path, true)
          }
          return
        }
        flash(
          result.status === 409
            ? createKind === 'folder'
              ? t('folderExists')
              : t('fileExists')
            : result.body.message || t('writeFailed'),
        )
      }

      async function openInky() {
        const result = await postJson('/open', { path: current, dir: dirField() })
        if (result.status !== 200) {
          flash(result.body.message || t('openFailed'))
        }
      }

      async function openFolder() {
        const result = await postJson('/folder', { dir: dirField() })
        if (result.status !== 200) flash(result.body.message || t('openFailed'))
      }

      // ------------------------------------------------------------- effects

      useEffect(() => {
        void refreshState(true)
        return () => {
          if (noticeTimer.current !== 0) clearTimeout(noticeTimer.current)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      useEffect(() => {
        const timer = setInterval(() => {
          const win = standaloneWindowRef.current
          if (win !== null && win.closed) {
            standaloneWindowRef.current = null
            setStandaloneOpen(false)
          }
        }, 1200)
        return () => clearInterval(timer)
      }, [])

      useEffect(() => {
        let alive = true
        void (async () => {
          try {
            const result = await request('/window')
            if (!alive || result.status !== 200 || result.body?.mode !== 'electron') return
            setStandaloneOpen(result.body.open === true)
          } catch {
            // No native window route on an older host.
          }
        })()
        return () => {
          alive = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      useEffect(() => {
        let alive = true
        const timer = setInterval(() => {
          void (async () => {
            try {
              const result = await request('/window')
              if (!alive || result.status !== 200 || result.body?.mode !== 'electron') return
              setStandaloneOpen(result.body.open === true)
            } catch {
              // Ignore transient route failures.
            }
          })()
        }, 3000)
        return () => {
          alive = false
          clearInterval(timer)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      useEffect(() => {
        const timer = setInterval(async () => {
          const snapshot = live.current
          const result = await request('/state' + projectQuery({ meta: '1' }))
          if (result.status !== 200) return
          setState((previous) =>
            previous === null
              ? result.body
              : { ...previous, ...result.body, vocab: result.body.vocab ?? previous.vocab },
          )
          void loadListing(live.current.subdir, true)
          if (!snapshot.current) return
          const entry = (result.body.files ?? []).find((file) => file.path === snapshot.current)
          if (entry === undefined || Math.abs(entry.mtimeMs - snapshot.mtimeMs) <= 1) return
          if (snapshot.dirty) {
            setStale(true)
            return
          }
          const loaded = await request(`/file?path=${encodeURIComponent(snapshot.current)}`)
          if (loaded.status !== 200) return
          const loadedContent = loaded.body.content ?? ''
          const loadedMtime = Number(loaded.body.mtimeMs) || 0
          setContent(loadedContent)
          resetHistory()
          setMtimeMs(loadedMtime)
          setStale(false)
          buffersRef.current.set(snapshot.current, {
            content: loadedContent,
            dirty: false,
            mtimeMs: loadedMtime,
            caret: 0,
            scrollTop: 0,
            undo: [],
            redo: [],
            lastEdit: { at: 0, kind: '' },
          })
          rememberRecentFile(snapshot.current, loadedContent, loadedMtime)
        }, POLL_MS)
        return () => clearInterval(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      // Alt + wheel zooms the editor text inside the panel. The native
      // listener is non-passive so preventDefault actually stops the shell's
      // own wheel handling (React's onWheel is passive for wheel events).
      useEffect(() => {
        const element = rootRef.current
        if (element === null) return
        const onWheel = (event) => {
          if (!event.altKey) return
          event.preventDefault()
          changeZoom(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
        }
        element.addEventListener('wheel', onWheel, { passive: false })
        return () => element.removeEventListener('wheel', onWheel)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      // Wrapping depends on the textarea's real content width: keep it up to
      // date when the panel is resized or the sidebar collapses.
      useEffect(() => {
        const element = taRef.current
        if (element === null) return
        const update = () => {
          setContentWidth(Math.max(120, element.clientWidth - 20))
          // The gutterless highlight layer must reserve exactly what the
          // textarea's scrollbar takes, or wrapped lines drift apart.
          setScrollbarWidth(Math.max(0, element.offsetWidth - element.clientWidth))
        }
        update()
        if (typeof ResizeObserver !== 'undefined') {
          const observer = new ResizeObserver(update)
          observer.observe(element)
          return () => observer.disconnect()
        }
        window.addEventListener('resize', update)
        return () => window.removeEventListener('resize', update)
      }, [])

      // Track the preview's text width so "wrap like the preview" stays exact
      // when the window (and therefore the composer column) is resized.
      useEffect(() => {
        const element = previewRef.current
        if (element === null) return
        const update = () => setPreviewWidth(element.clientWidth)
        update()
        if (typeof ResizeObserver !== 'undefined') {
          const observer = new ResizeObserver(update)
          observer.observe(element)
          return () => observer.disconnect()
        }
        window.addEventListener('resize', update)
        return () => window.removeEventListener('resize', update)
      }, [rightOpen])

      // -------------------------------------------------------------- editor

      function updateCaret(index) {
        const position = typeof index === 'number' ? index : 0
        const element = taRef.current
        const text = element === null ? content : element.value
        const before = text.slice(0, position)
        const lines = before.split('\n')
        setCaret({ line: lines.length, col: lines[lines.length - 1].length + 1, index: position })
      }

      function closeCompletion() {
        setCompletion(null)
      }

      /** Screen position (inside the editor pane) of the caret, for the popup. */
      function placeCompletion(caret) {
        const element = taRef.current
        const text = element === null ? content : element.value
        const lineStart = text.lastIndexOf('\n', Math.max(0, caret - 1)) + 1
        const linePrefix = text.slice(lineStart, caret)
        const lineIndex = text.slice(0, lineStart).split('\n').length - 1
        let extra = 0
        let x = 10
        let context = measureRef.current
        if (context === null && typeof document !== 'undefined') {
          const canvas = document.createElement('canvas')
          context = canvas.getContext('2d')
          measureRef.current = context
        }
        if (context !== null && context !== undefined) {
          context.font = `${fontSize}px ${FONT_STACK}`
          const width = context.measureText(linePrefix).width
          const available = Math.max(120, contentWidth)
          extra = Math.floor(width / available)
          x = 10 + width - extra * available
        }
        const visual = (wrapInfo.starts[lineIndex] ?? lineIndex) + extra
        const scrollTop = element === null ? 0 : element.scrollTop
        const paneWidth = element === null ? 400 : element.clientWidth
        const paneHeight = element === null ? 300 : element.clientHeight
        return {
          left: Math.max(4, Math.min(x, paneWidth - 260)),
          top: Math.max(4, Math.min(8 + (visual + 1) * lineHeight - scrollTop, paneHeight - 120)),
        }
      }

      function updateCompletions() {
        if (foldedSections.size > 0) {
          closeCompletion()
          return
        }
        const element = taRef.current
        if (element === null || composing) {
          closeCompletion()
          return
        }
        // A freshly accepted item must not immediately re-open its own popup.
        if (Date.now() - lastAccept.current < 250) {
          closeCompletion()
          return
        }
        const text = element.value
        const caret = element.selectionStart
        if (element.selectionStart !== element.selectionEnd) {
          closeCompletion()
          return
        }
        const before = text.slice(0, caret)
        const lineStart = before.lastIndexOf('\n') + 1
        const linePrefix = before.slice(lineStart)
        if (/^\s*\/\//.test(linePrefix)) {
          closeCompletion()
          return
        }

        const show = (items, start, end) => {
          const unique = []
          const seen = new Set()
          for (const item of items) {
            if (item.label === '' || seen.has(item.label)) continue
            seen.add(item.label)
            unique.push(item)
            if (unique.length >= 12) break
          }
          if (unique.length === 0) {
            closeCompletion()
            return
          }
          const previous = completionRef.current
          const same =
            previous !== null &&
            previous.start === start &&
            previous.end === end &&
            previous.caret === caret &&
            previous.items.length === unique.length &&
            previous.items.every((item, index) => item.label === unique[index].label)
          const place = placeCompletion(caret)
          setCompletion({
            items: unique,
            index: same ? previous.index : 0,
            start,
            end,
            caret,
            left: place.left,
            top: place.top,
          })
        }

        const extend = (from, test) => {
          let end = from
          while (end < text.length && test(text[end])) end += 1
          return end
        }

        const divert = /(?:->|<-)\s*([A-Za-z0-9_\u4e00-\u9fff.]*)$/.exec(linePrefix)
        if (divert !== null) {
          const prefix = divert[1].toLowerCase()
          const divertEnd = extend(caret, (ch) => /[A-Za-z0-9_\u4e00-\u9fff.]/.test(ch))
          const names = [
            ...inkSymbols.knots,
            ...inkSymbols.stitches,
            ...inkSymbols.functions,
            'END',
            'DONE',
          ]
          show(
            names
              .filter((name) => name.toLowerCase().startsWith(prefix))
              .map((name) => ({ label: name, kind: 'knot', kindLabel: t('kindKnot') })),
            caret - divert[1].length,
            divertEnd,
          )
          return
        }

        const tagValue = /#([A-Za-z0-9_\u4e00-\u9fff-]+):([^#\n]*)$/.exec(linePrefix)
        if (tagValue !== null) {
          const key = tagValue[1]
          const raw = tagValue[2]
          const prefix = raw.trimStart()
          const valueStart = caret - raw.length
          let valueEnd = caret
          while (valueEnd < text.length) {
            const ch = text[valueEnd]
            if (ch === '#' || ch === '\n') break
            if (ch === ' ' && (text.startsWith('->', valueEnd + 1) || text.startsWith('<-', valueEnd + 1))) break
            valueEnd += 1
          }
          while (valueEnd > caret && (text[valueEnd - 1] === ' ' || text[valueEnd - 1] === '\t')) {
            valueEnd -= 1
          }
          const lower = prefix.toLowerCase()
          show(
            valuesOf(vocab, customTags, key)
              .filter((value) => value.toLowerCase().startsWith(lower))
              .map((value) => ({ label: value, kind: 'value', kindLabel: t('kindValue') })),
            valueStart,
            valueEnd,
          )
          return
        }

        const tagKey = /#([A-Za-z0-9_\u4e00-\u9fff-]*)$/.exec(linePrefix)
        if (tagKey !== null) {
          const prefix = tagKey[1].toLowerCase()
          const keyEnd = extend(caret, (ch) => /[A-Za-z0-9_\u4e00-\u9fff-]/.test(ch))
          show(
            tagKeys
              .filter((key) => key.toLowerCase().startsWith(prefix))
              .map((key) => ({
                label: text[keyEnd] === ':' ? key : `${key}:`,
                kind: 'tag',
                kindLabel: t('kindTag'),
              })),
            caret - tagKey[1].length,
            keyEnd,
          )
          return
        }

        const word = /[A-Za-z0-9_\u4e00-\u9fff.]+$/.exec(linePrefix)
        if (word === null || word[0] === '') {
          closeCompletion()
          return
        }
        const wordEnd = extend(caret, (ch) => /[A-Za-z0-9_\u4e00-\u9fff.]/.test(ch))
        // In prose, keyword/name suggestions are noise; keep them for logic
        // lines and inside inline logic braces (diverts/tags are handled above).
        const lineTrim = linePrefix.trimStart()
        // A line that is still only the beginning of a declaration keyword
        // (e.g. "inc" on its way to INCLUDE) is already a logic line.
        const leadingWord = /^[A-Za-z_][A-Za-z0-9_]*$/.exec(lineTrim)
        const declarationPrefix =
          leadingWord !== null &&
          ['VAR', 'CONST', 'LIST', 'INCLUDE', 'EXTERNAL', 'TODO'].some((keyword) =>
            keyword.startsWith(leadingWord[0].toUpperCase()),
          )
        const logicContext =
          declarationPrefix === true ||
          /^(?:~|\b(?:VAR|CONST|LIST|INCLUDE|EXTERNAL)\b|TODO:)/.test(lineTrim) ||
          /\{[^}]*$/.test(linePrefix)
        if (!logicContext) {
          closeCompletion()
          return
        }
        const prefix = word[0].toLowerCase()
        const items = []
        for (const name of inkSymbols.variables) {
          items.push({ label: name, kind: 'var', kindLabel: t('kindVar') })
        }
        for (const name of inkSymbols.knots) {
          items.push({ label: name, kind: 'knot', kindLabel: t('kindKnot') })
        }
        for (const name of inkSymbols.stitches) {
          items.push({ label: name, kind: 'stitch', kindLabel: t('kindStitch') })
        }
        for (const name of inkSymbols.functions) {
          items.push({ label: name, kind: 'function', kindLabel: t('kindFunction') })
        }
        for (const name of COMPLETION_KEYWORDS) {
          items.push({ label: name, kind: 'keyword', kindLabel: t('kindKeyword') })
        }
        show(
          items.filter((item) => item.label.toLowerCase().startsWith(prefix)),
          caret - word[0].length,
          wordEnd,
        )
      }

      function acceptCompletion(item) {
        if (foldedSections.size > 0) return
        if (completion === null) return
        const element = taRef.current
        const text = element === null ? content : element.value
        const next = text.slice(0, completion.start) + item.label + text.slice(completion.end)
        pushHistory('action')
        setContent(next)
        setDirty(true)
        const caret = completion.start + item.label.length
        const isTagKey = item.kind === 'tag'
        if (!isTagKey) lastAccept.current = Date.now()
        setCompletion(null)
        requestAnimationFrame(() => {
          if (element !== null) {
            element.focus()
            element.setSelectionRange(caret, caret)
          }
          updateCaret(caret)
          if (isTagKey) requestAnimationFrame(updateCompletions)
        })
      }

      function syncCaretFromTextarea(event) {
        const element = event.target
        updateCaret(element.selectionStart)
        if (gutterRef.current !== null) gutterRef.current.scrollTop = element.scrollTop
        syncHighlightScroll()
      }

      function insertTextAtCaret(insert) {
        if (foldedSections.size > 0) {
          flash(t('foldUnfoldFirst'))
          return
        }
        const element = taRef.current
        if (element === null) return
        const start = element.selectionStart
        const end = element.selectionEnd
        const next = content.slice(0, start) + insert + content.slice(end)
        pushHistory('action')
        setContent(next)
        setDirty(true)
        const position = start + insert.length
        updateCaret(position)
        requestAnimationFrame(() => {
          element.focus()
          element.setSelectionRange(position, position)
        })
      }

      function onEditorKeyDown(event) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
          event.preventDefault()
          if (event.shiftKey) redo()
          else undo()
          return
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
          event.preventDefault()
          redo()
          return
        }
        if (completion !== null) {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const delta = event.key === 'ArrowDown' ? 1 : -1
            setCompletion((previous) =>
              previous === null
                ? previous
                : {
                    ...previous,
                    index: (previous.index + delta + previous.items.length) % previous.items.length,
                  },
            )
            return
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            const item = completion.items[completion.index]
            if (item !== undefined) acceptCompletion(item)
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setCompletion(null)
            lastAccept.current = Date.now()
            return
          }
        }
        if (event.key === 'Tab') {
          event.preventDefault()
          insertTextAtCaret('  ')
          return
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          void save(false)
        }
      }

      function jumpToLine(line) {
        if (foldedSections.size > 0) {
          flash(t('foldUnfoldFirst'))
          return
        }
        if (!line || line < 1) return
        const lines = content.split('\n')
        let offset = 0
        for (let index = 0; index < Math.min(line - 1, lines.length); index += 1) {
          offset += lines[index].length + 1
        }
        const element = taRef.current
        if (element === null) return
        element.focus()
        element.setSelectionRange(offset, offset)
        const visualRow = wrapInfo.starts[line - 1] ?? line - 1
        element.scrollTop = Math.max(0, visualRow * lineHeight - lineHeight)
        updateCaret(offset)
      }

      function scrollEditorToTop() {
        const element = taRef.current
        if (element === null) return
        element.scrollTo({ top: 0, behavior: 'smooth' })
      }

      // ------------------------------------------------------------ composer

      function selectedValue(key) {
        const customValue = (custom[key] ?? '').trim()
        if (customValue !== '') return customValue
        const choice = selected[key] ?? NONE
        if (choice === NONE) return null
        if (choice === EMPTY) return ''
        return choice
      }

      function currentTagsString() {
        const parts = []
        for (const key of tagKeys) {
          const value = selectedValue(key)
          if (value === null) continue
          parts.push(`#${key}:${value}`)
        }
        return parts.join(' ')
      }

      function presetTags(preset) {
        const keys = []
        const seen = new Set()
        for (const key of tagKeys) {
          keys.push(key)
          seen.add(key)
        }
        for (const key of [
          ...Object.keys(preset.selected ?? {}),
          ...Object.keys(preset.custom ?? {}),
        ]) {
          if (seen.has(key)) continue
          seen.add(key)
          keys.push(key)
        }
        const parts = []
        for (const key of keys) {
          const customValue = (preset.custom?.[key] ?? '').trim()
          const choice = preset.selected?.[key] ?? NONE
          const value =
            customValue !== ''
              ? customValue
              : choice === NONE
                ? null
                : choice === EMPTY
                  ? ''
                  : choice
          if (value === null) continue
          parts.push(`#${key}:${value}`)
        }
        return parts.join(' ')
      }

      function buildComposerLine() {
        const body = text.replace(/\s+$/, '')
        const destination = target.trim()
        if (lineKind === 'divert') return destination === '' ? '' : `-> ${destination}`
        if (body === '') return ''
        let base = body
        if (lineKind === 'choiceStar') base = `*[${body}]`
        if (lineKind === 'choicePlus') base = `+[${body}]`
        const tags = currentTagsString()
        let line = tags === '' ? base : `${base}${tags}`
        if ((lineKind === 'choiceStar' || lineKind === 'choicePlus') && destination !== '') {
          line += ` -> ${destination}`
        }
        return line
      }

      function mergeTagsIntoLine(lineText) {
        const keyPattern = tagKeys.map(escapeRegExp).join('|')
        const tagPattern = new RegExp(`#(?:${keyPattern}):[^#\\n]*`, 'g')
        const parsePattern = new RegExp(`#(${keyPattern}):([^#\\n]*)`, 'g')
        const existing = {}
        let match
        while ((match = parsePattern.exec(lineText)) !== null) {
          existing[match[1]] = match[2].trim()
        }
        let rest = lineText.replace(tagPattern, '').replace(/[ \t]+$/, '')
        let divert = ''
        const divertMatch = /(\s+->\s*[^\s]+)\s*$/.exec(rest)
        if (divertMatch !== null) {
          divert = divertMatch[1].trim()
          rest = rest.slice(0, divertMatch.index).replace(/[ \t]+$/, '')
        }
        const merged = { ...existing }
        for (const key of tagKeys) {
          const value = selectedValue(key)
          if (value === null) continue
          merged[key] = value
        }
        const tags = tagKeys
          .filter((key) => merged[key] !== undefined)
          .map((key) => `#${key}:${merged[key]}`)
          .join(' ')
        let line = tags === '' ? rest : `${rest}${tags}`
        if (divert !== '') line = `${line} ${divert}`
        return line.trim()
      }

      function applyToCurrentLine() {
        if (foldedSections.size > 0) {
          flash(t('foldUnfoldFirst'))
          return
        }
        const element = taRef.current
        if (element === null) return
        const position = element.selectionStart
        const start = content.lastIndexOf('\n', Math.max(0, position - 1)) + 1
        let end = content.indexOf('\n', position)
        if (end < 0) end = content.length
        const lineText = content.slice(start, end)
        const nextLine = mergeTagsIntoLine(lineText)
        const next = content.slice(0, start) + nextLine + content.slice(end)
        pushHistory('action')
        setContent(next)
        setDirty(true)
        const caretPosition = start + nextLine.length
        updateCaret(caretPosition)
        requestAnimationFrame(() => {
          element.focus()
          element.setSelectionRange(caretPosition, caretPosition)
        })
        flash(t('applied'))
      }

      function insertComposerLine() {
        if (foldedSections.size > 0) {
          flash(t('foldUnfoldFirst'))
          return
        }
        const line = buildComposerLine()
        if (line === '') {
          flash(t('emptyText'))
          return
        }
        const element = taRef.current
        const position = element === null ? content.length : element.selectionStart
        const start = content.lastIndexOf('\n', Math.max(0, position - 1)) + 1
        const next = content.slice(0, start) + line + '\n' + content.slice(start)
        pushHistory('action')
        setContent(next)
        setDirty(true)
        const caretPosition = start + line.length
        updateCaret(caretPosition)
        requestAnimationFrame(() => {
          if (element !== null) {
            element.focus()
            element.setSelectionRange(caretPosition, caretPosition)
          }
        })
        flash(t('inserted'))
      }

      function persistComposerPresets(next) {
        setComposerPresets(next)
        writeStorage(COMPOSER_PRESETS_KEY, next)
      }

      function applyComposerPreset(preset) {
        setLineKind(
          ['line', 'choiceStar', 'choicePlus', 'divert'].includes(preset.lineKind)
            ? preset.lineKind
            : 'line',
        )
        setText(preset.text ?? '')
        setTarget(preset.target ?? '')
        setSelected({ ...(preset.selected ?? {}) })
        setCustom({ ...(preset.custom ?? {}) })
        persistComposerPresets({ ...composerPresets, activeId: preset.id })
      }

      function addComposerPreset() {
        const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const names = new Set(composerPresets.presets.map((preset) => preset.name))
        let number = 1
        while (names.has(`${t('preset')} ${number}`)) number += 1
        const preset = {
          id,
          name: `${t('preset')} ${number}`,
          lineKind,
          text,
          target,
          selected: { ...selected },
          custom: { ...custom },
        }
        persistComposerPresets({
          presets: [...composerPresets.presets, preset],
          activeId: id,
        })
      }

      function deleteComposerPreset(preset) {
        if (!window.confirm(t('deletePresetConfirm'))) return
        let presets = composerPresets.presets.filter((entry) => entry.id !== preset.id)
        let activeId = composerPresets.activeId
        if (presets.length === 0) {
          const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          presets = [
            {
              id,
              name: `${t('preset')} 1`,
              lineKind: 'line',
              text: '',
              target: '',
              selected: {},
              custom: {},
            },
          ]
          activeId = id
        } else if (!presets.some((entry) => entry.id === activeId)) {
          activeId = presets[0].id
        }
        persistComposerPresets({ presets, activeId })
        flash(t('presetDeleted'))
      }

      function saveComposerPreset() {
        const activeId = composerPresets.activeId
        const presets = composerPresets.presets.map((preset) =>
          preset.id === activeId
            ? {
                ...preset,
                lineKind,
                text,
                target,
                selected: { ...selected },
                custom: { ...custom },
              }
            : preset,
        )
        persistComposerPresets({ presets, activeId })
        flash(t('presetSaved'))
      }

      function rememberTag(key) {
        const value = (custom[key] ?? '').trim()
        if (value === '') return
        const next = { ...customTags }
        const list = new Set(next[key] ?? [])
        list.add(value)
        next[key] = [...list]
        setCustomTags(next)
        writeStorage(CUSTOM_TAGS_KEY, next)
      }

      function addKey() {
        const key = newKey.trim()
        if (key === '' || tagKeys.includes(key)) return
        const next = [...customKeys, key]
        setCustomKeys(next)
        writeStorage(CUSTOM_KEYS_KEY, next)
        setNewKey('')
      }

      function setVocabDraft(key, value) {
        setVocabDrafts((previous) => ({ ...previous, [key]: value }))
      }

      function addVocabValue(key) {
        const value = (vocabDrafts[key] ?? '').trim()
        if (value === '') return
        const scanned = vocab[key] ?? []
        const existing = customTags[key] ?? []
        if (scanned.includes(value) || existing.includes(value)) {
          setVocabDraft(key, '')
          return
        }
        const next = { ...customTags, [key]: [...existing, value] }
        setCustomTags(next)
        writeStorage(CUSTOM_TAGS_KEY, next)
        setVocabDraft(key, '')
      }

      function removeVocabValue(key, value) {
        const list = (customTags[key] ?? []).filter((item) => item !== value)
        const next = { ...customTags }
        if (list.length === 0) delete next[key]
        else next[key] = list
        setCustomTags(next)
        writeStorage(CUSTOM_TAGS_KEY, next)
        if (selected[key] === value) {
          setSelected((previous) => ({ ...previous, [key]: NONE }))
        }
      }

      function removeVocabKey(key) {
        const nextKeys = customKeys.filter((item) => item !== key)
        setCustomKeys(nextKeys)
        writeStorage(CUSTOM_KEYS_KEY, nextKeys)
        const nextTags = { ...customTags }
        delete nextTags[key]
        setCustomTags(nextTags)
        writeStorage(CUSTOM_TAGS_KEY, nextTags)
      }

      function toggleOutline(id) {
        setOutlineCollapsed((previous) => {
          const next = new Set(previous)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }

      function openOutline() {
        // Opening the outline starts with every file collapsed; the user can
        // expand the ones they care about (that choice survives refreshes in
        // the same open session).
        outlineInitialCollapse.current = true
        setOutlineOpen(true)
        setOutlineNonce((value) => value + 1)
      }

      function closeOutline() {
        setOutlineOpen(false)
      }

      function openBlueprint() {
        setBlueprintPositions({})
        setBlueprintZoom(1)
        setBlueprintSelection(new Set())
        setBlueprintMarquee(null)
        setBlueprintOpen(true)
      }

      function closeBlueprint() {
        setBlueprintOpen(false)
      }

      function startBlueprintDrag(node, event) {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        const zoom = blueprintZoomRef.current
        const additive = event.shiftKey || event.ctrlKey || event.metaKey
        let selection = blueprintSelection
        if (additive) {
          const next = new Set(selection)
          next.add(node.id)
          selection = next
          setBlueprintSelection(next)
        } else if (!selection.has(node.id)) {
          selection = new Set([node.id])
          setBlueprintSelection(selection)
        }
        const startX = event.clientX
        const startY = event.clientY
        const origins = new Map()
        for (const id of selection) {
          const position = blueprintPositions[id] ?? blueprintData?.base[id]
          if (position !== undefined) origins.set(id, { x: position.x, y: position.y })
        }
        let moved = false
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'grabbing'
        const onMove = (moveEvent) => {
          const dx = (moveEvent.clientX - startX) / zoom
          const dy = (moveEvent.clientY - startY) / zoom
          if (Math.abs(dx) + Math.abs(dy) > 1.5) moved = true
          setBlueprintPositions((previous) => {
            const next = { ...previous }
            for (const [id, origin] of origins) {
              next[id] = { x: origin.x + dx, y: origin.y + dy }
            }
            return next
          })
        }
        const onUp = () => {
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
          document.body.style.userSelect = ''
          document.body.style.cursor = ''
          if (!moved && !additive && selection.size > 1) {
            setBlueprintSelection(new Set([node.id]))
          }
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      }

      function startMarquee(event) {
        if (event.button !== 0) return
        const canvas = blueprintCanvasRef.current
        if (canvas === null) return
        event.preventDefault()
        const zoom = blueprintZoomRef.current
        const rect = canvas.getBoundingClientRect()
        const startX = (event.clientX - rect.left + canvas.scrollLeft) / zoom
        const startY = (event.clientY - rect.top + canvas.scrollTop) / zoom
        const additive = event.shiftKey || event.ctrlKey || event.metaKey
        const baseSelection = additive ? new Set(blueprintSelection) : new Set()
        let moved = false
        document.body.style.userSelect = 'none'
        const onMove = (moveEvent) => {
          const current = blueprintCanvasRef.current
          if (current === null) return
          const box = current.getBoundingClientRect()
          const x = (moveEvent.clientX - box.left + current.scrollLeft) / zoom
          const y = (moveEvent.clientY - box.top + current.scrollTop) / zoom
          if (Math.abs(x - startX) + Math.abs(y - startY) > 3) moved = true
          setBlueprintMarquee({ x1: startX, y1: startY, x2: x, y2: y })
          const left = Math.min(startX, x)
          const right = Math.max(startX, x)
          const top = Math.min(startY, y)
          const bottom = Math.max(startY, y)
          const next = new Set(baseSelection)
          for (const node of blueprintData?.nodes ?? []) {
            const position = blueprintPositions[node.id] ?? blueprintData.base[node.id]
            if (position === undefined) continue
            if (
              position.x < right &&
              position.x + 190 > left &&
              position.y < bottom &&
              position.y + 64 > top
            ) {
              next.add(node.id)
            }
          }
          setBlueprintSelection(next)
        }
        const onUp = () => {
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
          document.body.style.userSelect = ''
          setBlueprintMarquee(null)
          if (!moved && !additive) setBlueprintSelection(new Set())
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      }

      function startMiddlePan(event) {
        if (event.button !== 1) return
        event.preventDefault()
        const canvas = blueprintCanvasRef.current
        if (canvas === null) return
        const startX = event.clientX
        const startY = event.clientY
        const startLeft = canvas.scrollLeft
        const startTop = canvas.scrollTop
        document.body.style.cursor = 'grabbing'
        const onMove = (moveEvent) => {
          canvas.scrollLeft = startLeft - (moveEvent.clientX - startX)
          canvas.scrollTop = startTop - (moveEvent.clientY - startY)
        }
        const onUp = () => {
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
          document.body.style.cursor = ''
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      }

      async function outlineJump(path, line) {
        if (!line || line < 1) return
        setOutlineOpen(false)
        if (path === current) {
          requestAnimationFrame(() => jumpToLine(line))
          return
        }
        const opened = await openFile(path, false)
        if (opened === true) setPendingJump({ path, line })
      }

      // Load every .ink file's source for the project outline.
      useEffect(() => {
        if (!outlineOpen) return
        let cancelled = false
        setOutlineLoading(true)
        setOutlineError('')
        request('/contents' + projectQuery())
          .then((result) => {
            if (cancelled) return
            setOutlineLoading(false)
            if (result.status !== 200) {
              setOutlineError(result.body.message || t('readFailed'))
              setOutlineFiles([])
              return
            }
            const files = Array.isArray(result.body.files) ? result.body.files : []
            setOutlineFiles(files)
            setOutlineTruncated(result.body.truncated === true)
            setOutlineSkipped(Number(result.body.skipped) || 0)
            if (outlineInitialCollapse.current) {
              outlineInitialCollapse.current = false
              const collapsed = new Set()
              for (const file of files) collapsed.add(`file:${file.path}`)
              if (current !== '') collapsed.add(`file:${current}`)
              setOutlineCollapsed(collapsed)
            }
          })
          .catch((error) => {
            if (cancelled) return
            setOutlineLoading(false)
            setOutlineError(String(error?.message ?? error))
            setOutlineFiles([])
          })
        return () => {
          cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [outlineOpen, outlineNonce, rootDir])

      // Jump after a cross-file outline click has opened its file.
      useEffect(() => {
        if (pendingJump === null || current !== pendingJump.path) return
        const line = pendingJump.line
        setPendingJump(null)
        requestAnimationFrame(() => jumpToLine(line))
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [pendingJump, current, content])

      // Wheel-zoom the blueprint canvas around the pointer.
      useEffect(() => {
        if (!blueprintOpen) return
        const canvas = blueprintCanvasRef.current
        if (canvas === null) return
        const onWheel = (event) => {
          event.preventDefault()
          const rect = canvas.getBoundingClientRect()
          const pointerX = event.clientX - rect.left
          const pointerY = event.clientY - rect.top
          const previous = blueprintZoomRef.current
          const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
          const next = Math.min(2.5, Math.max(0.3, previous * factor))
          if (Math.abs(next - previous) < 0.001) return
          const worldX = (canvas.scrollLeft + pointerX) / previous
          const worldY = (canvas.scrollTop + pointerY) / previous
          blueprintZoomRef.current = next
          setBlueprintZoom(next)
          requestAnimationFrame(() => {
            const current = blueprintCanvasRef.current
            if (current === null) return
            current.scrollLeft = worldX * next - pointerX
            current.scrollTop = worldY * next - pointerY
          })
        }
        canvas.addEventListener('wheel', onWheel, { passive: false })
        return () => canvas.removeEventListener('wheel', onWheel)
      }, [blueprintOpen])

      // Autosave a recoverable copy when editing pauses.
      useEffect(() => {
        if (!dirty || current === '') return
        const timer = setTimeout(() => {
          void saveBackupNow()
        }, 2000)
        return () => clearTimeout(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [content, dirty, current])

      // Save the copy when leaving; offer it again when coming back.
      useEffect(() => {
        const onLeave = () => {
          void saveBackupNow()
        }
        const onFocus = () => {
          void checkBackupForCurrent()
        }
        const onVisibility = () => {
          if (document.visibilityState === 'hidden') onLeave()
          else void checkBackupForCurrent()
        }
        window.addEventListener('blur', onLeave)
        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          window.removeEventListener('blur', onLeave)
          window.removeEventListener('focus', onFocus)
          document.removeEventListener('visibilitychange', onVisibility)
          onLeave()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      // Restart the preview after edits settle; stop it when the pane closes.
      useEffect(() => {
        if (!previewOpen || current === '') {
          previewSeq.current += 1
          stopPreview()
          resetPreviewTranscript()
          setPreviewError('')
          setPreviewLoading(false)
          return
        }
        const timer = setTimeout(() => {
          void startPreview()
        }, 700)
        return () => clearTimeout(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [previewOpen, current, content])

      useEffect(
        () => () => {
          previewSeq.current += 1
          clearPreviewReveal()
          stopPreview()
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
      )

      // --------------------------------------------------------------- render

      // A fresh file starts at the top; a restored tab keeps its caret/scroll.
      useEffect(() => {
        const textarea = taRef.current
        const nextScroll = pendingScrollRef.current
        const nextCaret = pendingCaretRef.current
        pendingScrollRef.current = null
        pendingCaretRef.current = null
        if (textarea !== null) {
          const scroll = current === '' ? 0 : nextScroll ?? 0
          textarea.scrollTop = scroll
          syncHighlightScroll()
          if (gutterRef.current !== null) gutterRef.current.scrollTop = scroll
          if (bandScrollRef.current !== null) bandScrollRef.current.scrollTop = scroll
          if (foldMarkerScrollRef.current !== null) foldMarkerScrollRef.current.scrollTop = scroll
          if (current !== '' && nextCaret !== null) {
            requestAnimationFrame(() => {
              textarea.focus()
              textarea.setSelectionRange(nextCaret, nextCaret)
              updateCaret(nextCaret)
            })
          }
        }
        setShowBackToTop(current !== '' && (nextScroll ?? 0) > 200)
        setFoldedSections(new Set())
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [current])

      // Keep the current file visible in the project browser.
      useEffect(() => {
        const element = activeFileRef.current
        if (element !== null) element.scrollIntoView({ block: 'nearest' })
      }, [current, subdir, leftOpen, listing?.path])

      // Reopening the project browser jumps back to the current file's folder.
      const previousLeftOpen = useRef(leftOpen)
      useEffect(() => {
        if (leftOpen && !previousLeftOpen.current && current !== '') {
          const dir = current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : ''
          if (dir !== live.current.subdir) void loadListing(dir, true)
        }
        previousLeftOpen.current = leftOpen
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [leftOpen, current])

      // Track whether the app theme is dark so the right accent color is used.
      useEffect(() => {
        let timer = 0
        const detect = () => {
          const element = rootRef.current
          if (element === null) return
          setThemeDark(isDarkCssColor(getComputedStyle(element).backgroundColor))
        }
        detect()
        const observer = new MutationObserver(detect)
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'],
        })
        window.addEventListener('focus', detect)
        timer = window.setInterval(detect, 1500)
        return () => {
          observer.disconnect()
          window.removeEventListener('focus', detect)
          window.clearInterval(timer)
        }
      }, [])

      const foldView = useMemo(() => {
        const lines = content.split('\n')
        const outline = parseInkOutline(content)
        const sections = []
        outline.knots.forEach((knot, index) => {
          const knotEnd = (outline.knots[index + 1]?.line ?? lines.length + 1) - 1
          for (let stitchIndex = 0; stitchIndex < knot.stitches.length; stitchIndex += 1) {
            const stitch = knot.stitches[stitchIndex]
            const stitchEnd =
              (knot.stitches[stitchIndex + 1]?.line ?? knotEnd + 1) - 1
            sections.push({ line: stitch.line, end: stitchEnd })
          }
          sections.push({ line: knot.line, end: knotEnd })
        })
        const byLine = new Map(sections.map((section) => [section.line, section]))
        const visible = []
        const lineNumbers = []
        let hiddenUntil = 0
        for (let index = 0; index < lines.length; index += 1) {
          const lineNo = index + 1
          if (lineNo <= hiddenUntil) continue
          visible.push(index)
          lineNumbers.push(lineNo)
          const section = byLine.get(lineNo)
          if (section !== undefined && foldedSections.has(lineNo)) {
            hiddenUntil = section.end
          }
        }
        const displayByOriginal = new Map(
          visible.map((originalIndex, displayIndex) => [originalIndex + 1, displayIndex + 1]),
        )
        return {
          viewContent: visible.map((index) => lines[index]).join('\n'),
          lineNumbers,
          displayByOriginal,
          byLine,
          lines,
          visible,
        }
      }, [content, foldedSections])
      const viewContent = foldView.viewContent
      const highlightEnabled = viewContent.length <= 300000
      const highlightHtml = useMemo(
        () => (highlightEnabled ? highlightInk(viewContent) : ''),
        [viewContent, highlightEnabled],
      )

      function syncHighlightScroll() {
        const textarea = taRef.current
        const highlight = highlightRef.current
        if (textarea !== null && highlight !== null) highlight.scrollTop = textarea.scrollTop
        if (textarea !== null && bandScrollRef.current !== null) {
          bandScrollRef.current.scrollTop = textarea.scrollTop
        }
        if (textarea !== null && foldMarkerScrollRef.current !== null) {
          foldMarkerScrollRef.current.scrollTop = textarea.scrollTop
        }
      }

      useLayoutEffect(() => {
        syncHighlightScroll()
      }, [highlightHtml, fontSize, scrollbarWidth, composing, highlightEnabled])

      // Keep the highlighted completion row inside the popup's scroll window
      // (scroll the list only, never the page/editor ancestors).
      useEffect(() => {
        if (completion === null) return
        const list = completionListRef.current
        if (list === null) return
        const active = list.children[completion.index]
        if (active === undefined) return
        const top = active.offsetTop
        const bottom = top + active.offsetHeight
        if (top < list.scrollTop) list.scrollTop = top
        else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
      }, [completion])

      const lineCount = viewContent === '' ? 1 : viewContent.split('\n').length
      const caretLineNumber = foldView.lineNumbers[caret.line - 1] ?? caret.line
      const editorBands = useMemo(() => {
        const infos = editorLineInfos(viewContent)
        const starts = wrapInfo.starts
        const total = wrapInfo.visualLines
        const highlightRgb = parseHexColor(foldHighlight) ?? [245, 158, 11]
        const highlightBackground = tintRgba(highlightRgb, 0.22)
        const foldedTitleLines = new Set()
        for (const line of foldedSections) {
          const display = foldView.displayByOriginal.get(line)
          if (display !== undefined) foldedTitleLines.add(display - 1)
        }
        const bands = []
        for (let index = 0; index < infos.length; index += 1) {
          const isFoldedTitle = foldedTitleLines.has(index)
          if (!isFoldedTitle && !bandTints) continue
          const info = infos[index]
          if (!isFoldedTitle && info === null) continue
          const start = starts[index] ?? index
          const end = starts[index + 1] ?? total
          const rows = Math.max(1, end - start)
          let background = highlightBackground
          if (!isFoldedTitle) {
            const custom = speakerColors[info.speaker]
            const rgb = custom === undefined ? null : parseHexColor(custom)
            background =
              rgb === null
                ? speakerBandColor(info.speaker, bandStrength)
                : tintRgba(rgb, SPEAKER_TINT_ALPHA * bandStrength)
          }
          bands.push({
            key: index,
            top: 8 + start * lineHeight,
            height: rows * lineHeight,
            background,
            borderLeft: isFoldedTitle ? `3px solid ${foldHighlight}` : undefined,
          })
        }
        return bands
      }, [
        viewContent,
        bandTints,
        bandStrength,
        wrapInfo,
        lineHeight,
        foldedSections,
        foldView,
        foldHighlight,
        speakerColors,
      ])

      const foldHeaders = useMemo(() => {
        const outline = parseInkOutline(content)
        const headers = []
        for (const knot of outline.knots) {
          for (const stitch of knot.stitches) headers.push(stitch.line)
          headers.push(knot.line)
        }
        headers.sort((a, b) => a - b)
        return headers
      }, [content])
      const hasFoldable = foldHeaders.length > 0

      // If a folded heading stops being a heading (edited away), drop the fold.
      useEffect(() => {
        if (foldedSections.size === 0) return
        const valid = new Set(foldHeaders)
        let stale = false
        for (const line of foldedSections) {
          if (!valid.has(line)) {
            stale = true
            break
          }
        }
        if (!stale) return
        setFoldedSections((previous) => {
          const next = new Set()
          for (const line of previous) if (valid.has(line)) next.add(line)
          return next
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [foldHeaders])

      const detectedSpeakers = useMemo(() => {
        const result = ['']
        const seen = new Set([''])
        for (const line of content.split('\n')) {
          const trimmed = line.trim()
          if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue
          const speaker = speakerValueFromLine(line)
          if (speaker !== null && !seen.has(speaker)) {
            seen.add(speaker)
            result.push(speaker)
          }
        }
        return result
      }, [content])

      const speakerColorActive =
        speakerColorTarget !== null && detectedSpeakers.includes(speakerColorTarget)
          ? speakerColorTarget
          : (detectedSpeakers.find((speaker) => speaker !== '') ?? '')

      // Keep the fold markers aligned when the fold gutter appears or moves.
      useEffect(() => {
        syncHighlightScroll()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [foldEnabled, hasFoldable])
      // Exact gutter rows: lay every logical line out in a hidden mirror with
      // the editor's real width and font, then read the browser's own line
      // boxes. The previous canvas estimate drifted by one row whenever a
      // wrap landed on a pixel boundary, which shifted every later number.
      useLayoutEffect(() => {
        const mirror = mirrorRef.current
        if (mirror === null) return
        const lines = viewContent.split('\n')
        mirror.textContent = ''
        const fragment = document.createDocumentFragment()
        for (const line of lines) {
          const row = document.createElement('div')
          row.textContent = line === '' ? '\u200b' : line
          fragment.appendChild(row)
        }
        mirror.appendChild(fragment)
        const starts = []
        const rows = []
        let visual = 0
        const total = Math.min(mirror.children.length, lines.length)
        for (let index = 0; index < total; index += 1) {
          const child = mirror.children[index]
          starts.push(Math.round(child.offsetTop / lineHeight))
          const span = Math.max(1, Math.round(child.offsetHeight / lineHeight))
          rows.push(String(foldView.lineNumbers[index] ?? index + 1))
          for (let extra = 1; extra < span; extra += 1) rows.push('')
          visual += span
        }
        setWrapInfo({ text: rows.join('\n'), starts, visualLines: visual })
      }, [viewContent, foldView, fontSize, lineHeight, contentWidth])
      const previewLine = buildComposerLine()
      const hasFile = current !== ''
      const segments = subdir === '' ? [] : subdir.split('/').filter(Boolean)

      const outlineData = useMemo(() => {
        if (!outlineOpen) return null
        const list = outlineFiles.slice()
        if (current !== '' && !list.some((file) => file.path === current)) {
          list.push({ path: current, content, size: 0, mtimeMs: 0 })
        }
        const files = []
        const nameMap = new Map()
        for (const file of list) {
          const text = file.path === current ? content : (file.content ?? '')
          const outline = parseInkOutline(text)
          files.push({ path: file.path, outline })
          for (const [name, line] of Object.entries(outline.nameToLine)) {
            if (!nameMap.has(name)) nameMap.set(name, { path: file.path, line })
          }
        }
        return { files, nameMap }
      }, [outlineOpen, outlineFiles, current, content])

      const outlineTotals = useMemo(() => {
        if (outlineData === null) return { files: 0, knots: 0, stitches: 0, functions: 0 }
        let knots = 0
        let stitches = 0
        let functions = 0
        for (const file of outlineData.files) {
          knots += file.outline.knots.length
          stitches += file.outline.knots.reduce((sum, knot) => sum + knot.stitches.length, 0)
          functions += file.outline.functions.length
        }
        return { files: outlineData.files.length, knots, stitches, functions }
      }, [outlineData])

      const blueprintData = useMemo(
        () => (blueprintOpen && current !== '' ? buildBlueprint(parseInkOutline(content)) : null),
        [blueprintOpen, current, content],
      )

      let blueprintWidth = blueprintData?.width ?? 900
      let blueprintHeight = blueprintData?.height ?? 520
      if (blueprintData !== null) {
        for (const node of blueprintData.nodes) {
          const position = blueprintPositions[node.id] ?? blueprintData.base[node.id]
          if (position !== undefined) {
            blueprintWidth = Math.max(blueprintWidth, position.x + 260)
            blueprintHeight = Math.max(blueprintHeight, position.y + 140)
          }
        }
      }

      function blueprintKindColor(kind) {
        if (kind === 'knot') return '#3b82f6'
        if (kind === 'stitch') return '#0d9488'
        if (kind === 'function') return '#d946ef'
        if (kind === 'intro') return '#22c55e'
        if (kind === 'end') return '#6b7280'
        return 'var(--dsw-alias-state-warn-primary)'
      }

      function blueprintEdgePath(edge) {
        if (blueprintData === null) return ''
        const from = blueprintPositions[edge.from] ?? blueprintData.base[edge.from] ?? { x: 0, y: 0 }
        const to = blueprintPositions[edge.to] ?? blueprintData.base[edge.to] ?? { x: 0, y: 0 }
        const forward = to.x >= from.x
        const sx = forward ? from.x + 190 : from.x
        const tx = forward ? to.x : to.x + 190
        const sy = from.y + 32
        const ty = to.y + 32
        const bend = Math.max(60, Math.abs(tx - sx) * 0.55)
        return `M ${sx} ${sy} C ${sx + (forward ? bend : -bend)} ${sy}, ${tx - (forward ? bend : -bend)} ${ty}, ${tx} ${ty}`
      }

      function outlineChevron(id, hasChildren) {
        if (!hasChildren) return h('span', { style: { width: 14, flex: '0 0 14px' } })
        const collapsed = outlineCollapsed.has(id)
        return h(
          'button',
          {
            type: 'button',
            onClick: (event) => {
              event.stopPropagation()
              toggleOutline(id)
            },
            style: {
              width: 14,
              height: 14,
              flex: '0 0 14px',
              padding: 0,
              border: 'none',
              background: 'transparent',
              color: 'var(--dsw-alias-label-secondary)',
              cursor: 'pointer',
              fontSize: 10,
              lineHeight: 1,
            },
          },
          collapsed ? '▸' : '▾',
        )
      }

      function outlineRow({ id, label, line, depth, hasChildren, onClick, color, tail, title }) {
        return h(
          'div',
          {
            key: id,
            onClick: onClick ?? undefined,
            title,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '2px 4px',
              paddingLeft: 4 + depth * 14,
              borderRadius: 4,
              cursor: onClick ? 'pointer' : 'default',
            },
          },
          outlineChevron(id, hasChildren === true),
          h(
            'span',
            {
              style: {
                flex: 1,
                minWidth: 0,
                fontFamily: FONT_STACK,
                fontSize: 12,
                color: color ?? 'var(--dsw-alias-label-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
            },
            label,
          ),
          tail !== undefined && tail !== null
            ? h(
                'span',
                { style: { flex: '0 0 auto', fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } },
                tail,
              )
            : null,
          line
            ? h(
                'span',
                {
                  style: {
                    flex: '0 0 auto',
                    minWidth: 18,
                    textAlign: 'right',
                    fontSize: 10,
                    color: 'var(--dsw-alias-label-secondary)',
                  },
                },
                String(line),
              )
            : null,
        )
      }

      function outlineSection(id, title, count, depth, children) {
        const collapsed = outlineCollapsed.has(id)
        return h(
          'div',
          { key: id },
          h(
            'div',
            {
              onClick: () => toggleOutline(id),
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '2px 4px',
                paddingLeft: 4 + depth * 14,
                borderRadius: 4,
                cursor: 'pointer',
              },
            },
            outlineChevron(id, true),
            h(
              'span',
              {
                style: {
                  flex: 1,
                  minWidth: 0,
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--dsw-alias-label-secondary)',
                },
              },
              title,
            ),
            count !== undefined && count !== null
              ? h(
                  'span',
                  { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } },
                  String(count),
                )
              : null,
          ),
          collapsed ? null : children,
        )
      }

      function resolveOutlineTarget(filePath, outline, target) {
        const local = outline.nameToLine[target]
        if (local !== undefined) return { path: filePath, line: local, external: false }
        const found = outlineData.nameMap.get(target)
        if (found !== undefined) {
          return { path: found.path, line: found.line, external: found.path !== filePath }
        }
        return null
      }

      function outlineDivertRow(filePath, outline, divert, depth) {
        const resolved = resolveOutlineTarget(filePath, outline, divert.target)
        const isEnd = divert.target === 'END' || divert.target === 'DONE'
        const unresolved = resolved === null && !isEnd
        const targetPath = resolved?.path ?? filePath
        const line = resolved?.line ?? divert.line
        const tail = isEnd
          ? null
          : resolved?.external
            ? resolved.path
            : unresolved
              ? t('outlineUndefined')
              : null
        return outlineRow({
          id: `${filePath}::d:${divert.line}:${divert.target}`,
          label: `→ ${divert.target}`,
          line,
          depth,
          color: unresolved
            ? 'var(--dsw-alias-state-warn-primary)'
            : 'var(--dsw-alias-brand-primary)',
          tail,
          title: resolved ? `${targetPath}:${line}` : t('outlineUndefined'),
          onClick: () => void outlineJump(targetPath, line),
        })
      }

      function outlineStitchRow(filePath, outline, stitch, depth) {
        const id = `${filePath}::${stitch.id}`
        const collapsed = outlineCollapsed.has(id)
        const children = []
        if (!collapsed) {
          for (const divert of stitch.diverts) {
            children.push(outlineDivertRow(filePath, outline, divert, depth + 1))
          }
        }
        return h(
          'div',
          { key: id },
          outlineRow({
            id,
            label: stitch.name,
            line: stitch.line,
            depth,
            hasChildren: stitch.diverts.length > 0,
            color: 'var(--dsw-alias-label-secondary)',
            onClick: () => void outlineJump(filePath, stitch.line),
          }),
          children,
        )
      }

      function outlineKnotRow(filePath, outline, knot, depth) {
        const id = `${filePath}::${knot.id}`
        const collapsed = outlineCollapsed.has(id)
        const children = []
        if (!collapsed) {
          for (const stitch of knot.stitches) {
            children.push(outlineStitchRow(filePath, outline, stitch, depth + 1))
          }
          for (const divert of knot.diverts) {
            children.push(outlineDivertRow(filePath, outline, divert, depth + 1))
          }
        }
        return h(
          'div',
          { key: id },
          outlineRow({
            id,
            label: knot.name,
            line: knot.line,
            depth,
            hasChildren: knot.stitches.length > 0 || knot.diverts.length > 0,
            onClick: () => void outlineJump(filePath, knot.line),
            title: `${filePath}:${knot.line}`,
          }),
          children,
        )
      }

      function outlineFunctionRow(filePath, outline, fn, depth) {
        const id = `${filePath}::${fn.id}`
        const collapsed = outlineCollapsed.has(id)
        const children = []
        if (!collapsed) {
          for (const divert of fn.diverts) {
            children.push(outlineDivertRow(filePath, outline, divert, depth + 1))
          }
        }
        return h(
          'div',
          { key: id },
          outlineRow({
            id,
            label: `function ${fn.name}`,
            line: fn.line,
            depth,
            hasChildren: fn.diverts.length > 0,
            color: 'var(--dsw-alias-label-secondary)',
            onClick: () => void outlineJump(filePath, fn.line),
          }),
          children,
        )
      }

      function renderOutlineFile(file) {
        const { path, outline } = file
        const fileId = `file:${path}`
        const collapsed = outlineCollapsed.has(fileId)
        const isCurrent = path === current
        const stitchCount = outline.knots.reduce((sum, knot) => sum + knot.stitches.length, 0)
        const body = []
        if (!collapsed) {
          if (outline.intro.length > 0) {
            body.push(
              outlineSection(
                `${path}::sec:intro`,
                t('outlineIntro'),
                outline.intro.length,
                1,
                outline.intro.map((divert) => outlineDivertRow(path, outline, divert, 2)),
              ),
            )
          }
          if (outline.includes.length > 0 || outline.variables.length > 0) {
            const rows = []
            for (const include of outline.includes) {
              rows.push(
                outlineRow({
                  id: `${path}::inc:${include.line}`,
                  label: `INCLUDE ${include.text}`,
                  line: include.line,
                  depth: 2,
                  onClick: () => void outlineJump(path, include.line),
                }),
              )
            }
            for (const variable of outline.variables) {
              rows.push(
                outlineRow({
                  id: `${path}::var:${variable.line}`,
                  label: `${variable.kind} ${variable.name}`,
                  line: variable.line,
                  depth: 2,
                  onClick: () => void outlineJump(path, variable.line),
                }),
              )
            }
            body.push(
              outlineSection(`${path}::sec:globals`, t('outlineGlobals'), rows.length, 1, rows),
            )
          }
          if (outline.knots.length > 0) {
            body.push(
              outlineSection(
                `${path}::sec:knots`,
                t('outlineKnots'),
                outline.knots.length,
                1,
                outline.knots.map((knot) => outlineKnotRow(path, outline, knot, 2)),
              ),
            )
          }
          if (outline.functions.length > 0) {
            body.push(
              outlineSection(
                `${path}::sec:functions`,
                t('outlineFunctions'),
                outline.functions.length,
                1,
                outline.functions.map((fn) => outlineFunctionRow(path, outline, fn, 2)),
              ),
            )
          }
          if (body.length === 0) {
            body.push(
              h(
                'div',
                {
                  key: `${path}::empty`,
                  style: {
                    padding: '4px 8px 8px 22px',
                    fontSize: 11,
                    color: 'var(--dsw-alias-label-secondary)',
                  },
                },
                t('outlineNoStructure'),
              ),
            )
          }
        }
        return h(
          'div',
          { key: path, style: { marginBottom: 6 } },
          h(
            'div',
            {
              onClick: () => toggleOutline(fileId),
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px',
                borderTop: '1px solid var(--dsw-alias-border-l1)',
                borderRadius: 4,
                cursor: 'pointer',
              },
            },
            outlineChevron(fileId, true),
            h(
              'span',
              {
                style: {
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              path,
            ),
            isCurrent
              ? h(
                  'span',
                  {
                    style: {
                      fontSize: 9,
                      color: 'var(--dsw-alias-brand-primary)',
                      border: '1px solid var(--dsw-alias-brand-primary)',
                      borderRadius: 8,
                      padding: '0 4px',
                    },
                  },
                  t('outlineCurrent'),
                )
              : null,
            h(
              'span',
              { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } },
              `${outline.knots.length} ${t('outlineKnots')} · ${stitchCount} ${t('outlineStitches')} · ${outline.functions.length} ${t('outlineFunctions')}`,
            ),
          ),
          body,
        )
      }

      const iconOnly = labelMode === 'icons'
      const actionDivider = (key) =>
        h('span', {
          key,
          style:
            railPlacement === 'left'
              ? {
                  height: 1,
                  background: 'var(--dsw-alias-border-l1)',
                  margin: '2px 4px',
                  flex: '0 0 auto',
                }
              : {
                  width: 1,
                  height: 18,
                  alignSelf: 'center',
                  background: 'var(--dsw-alias-border-l1)',
                  margin: '0 2px',
                  flex: '0 0 auto',
                },
        })
      const rawActionButtons = [
        h(
          Btn,
          {
            key: 'filesPanel',
            icon: 'sidebar',
            iconOnly,
            onClick: toggleLeft,
            title: leftOpen ? t('collapseFiles') : t('expandFiles'),
          },
          t('filesPanel'),
        ),
        h(
          Btn,
          {
            key: 'composerPanel',
            icon: 'compose',
            iconOnly,
            onClick: toggleRight,
            title: rightOpen ? t('collapseComposer') : t('expandComposer'),
          },
          t('composerPanel'),
        ),
        h(
          Btn,
          { key: 'dir', icon: 'folderOpen', iconOnly, onClick: openDirEditor, title: t('switchDirHint') },
          t('switchDir'),
        ),
        h(
          Btn,
          { key: 'vocab', icon: 'tag', iconOnly, onClick: () => setVocabOpen(true), title: t('vocabTitle') },
          t('vocab'),
        ),
        h(
          Btn,
          { key: 'outline', icon: 'outline', iconOnly, onClick: openOutline, title: t('outlineTitle') },
          t('outline'),
        ),
        h(
          Btn,
          {
            key: 'blueprint',
            icon: 'blueprint',
            iconOnly,
            onClick: openBlueprint,
            disabled: !hasFile,
            title: t('blueprintTitle'),
          },
          t('blueprint'),
        ),
        h(
          Btn,
          {
            key: 'preview',
            icon: 'preview',
            iconOnly,
            onClick: togglePreview,
            disabled: !hasFile,
            primary: previewOpen,
            title: t('previewTitle'),
          },
          t('preview'),
        ),
        h(
          Btn,
          {
            key: 'save',
            icon: 'save',
            iconOnly,
            primary: true,
            onClick: () => save(false),
            disabled: !hasFile || busy !== '',
            title: t('saveHint'),
          },
          t('save'),
        ),
        h(
          Btn,
          {
            key: 'check',
            icon: 'check',
            iconOnly,
            onClick: check,
            disabled: !hasFile || busy !== '',
          },
          t('check'),
        ),
        h(
          Btn,
          {
            key: 'reload',
            icon: 'reload',
            iconOnly,
            onClick: () => openFile(current, true),
            disabled: !hasFile || busy !== '',
          },
          t('reloadFromDisk'),
        ),
        h(
          Btn,
          {
            key: 'refresh',
            icon: 'refresh',
            iconOnly,
            onClick: refreshProject,
            disabled: busy !== '',
            title: t('refreshHint'),
          },
          t('refresh'),
        ),
        ...(standaloneMode
          ? []
          : [
              h(
                Btn,
                {
                  key: 'popout',
                  icon: 'external',
                  iconOnly,
                  onClick: toggleStandaloneWindow,
                  primary: standaloneOpen,
                  title: t('popoutHint'),
                },
                standaloneOpen ? t('popoutClose') : t('popout'),
              ),
            ]),
        h(
          Btn,
          {
            key: 'inky',
            icon: 'external',
            iconOnly,
            onClick: openInky,
            disabled: !hasFile || busy !== '',
          },
          t('openInky'),
        ),
        h(Btn, { key: 'folder', icon: 'folder', iconOnly, onClick: openFolder }, t('openFolder')),
      ]

      const isButtonVisible = (key) => buttonVisibility[key] !== false
      const buttonByKey = new Map()
      for (const item of rawActionButtons) {
        if (typeof item.key === 'string') buttonByKey.set(item.key, item)
      }
      const actionButtons = []
      const visibleGroups = ACTION_GROUPS.map((group) =>
        group.filter(isButtonVisible),
      ).filter((group) => group.length > 0)
      visibleGroups.forEach((group, index) => {
        if (index > 0) actionButtons.push(actionDivider(`group-${index}`))
        for (const key of group) {
          const button = buttonByKey.get(key)
          if (button !== undefined) actionButtons.push(button)
        }
      })

      const dragHandle = h(
        'button',
        {
          key: 'rail-drag',
          type: 'button',
          className: 'dsh-ink-drag',
          title: t('railDragHint'),
          'aria-label': t('railDragHint'),
          onMouseDown: startRailDrag,
          style: S.dragHandle,
        },
        h(ActionIcon, { name: 'grip', size: 14 }),
      )

      const appearanceButton = h(
        Btn,
        {
          key: 'appearance',
          icon: 'palette',
          iconOnly: labelMode === 'icons',
          onClick: () => setAppearanceOpen(true),
          tip: t('appearance'),
          title: t('appearance'),
        },
        t('appearance'),
      )

      const interfaceButton = h(
        Btn,
        {
          key: 'interface',
          icon: 'window',
          iconOnly: labelMode === 'icons',
          onClick: () => setInterfaceOpen(true),
          tip: t('interface'),
          title: t('interface'),
        },
        t('interface'),
      )

      const accent = themeDark ? uiColors.dark : uiColors.light
      const accentContrast = readableOn(accent)

      const titleGroup = h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
            flexShrink: 1,
            marginLeft: 'auto',
          },
        },
        h(
          'span',
          {
            style: {
              display: 'inline-flex',
              color: 'var(--dsw-alias-brand-primary)',
            },
          },
          h(ActionIcon, { name: 'tag', size: 14 }),
        ),
        h(
          'span',
          {
            style: {
              ...S.title,
              fontSize: 13,
              color: 'var(--dsw-alias-label-primary)',
              whiteSpace: 'nowrap',
            },
          },
          t('panelTitle'),
        ),
        h(
          'span',
          {
            style: { ...S.meta, maxWidth: 420, marginLeft: 2 },
            title: state?.projectDir ?? '',
          },
          `${t('project')}: ${state?.projectDir ?? '…'}`,
        ),
      )

      function appearanceColorRow(themeKey, labelKey) {
        return h(
          'div',
          { style: S.appearanceSection },
          h('div', { style: S.appearanceLabel }, t(labelKey)),
          h(
            'div',
            { style: S.appearanceRow },
            h('input', {
              type: 'color',
              value: uiColors[themeKey],
              onChange: (event) => updateUiColor(themeKey, event.target.value),
              style: S.colorInput,
            }),
            h('span', { style: S.appearanceHex }, uiColors[themeKey]),
            ...PRESET_COLORS.map((color) =>
              h('button', {
                key: color,
                type: 'button',
                title: color,
                onClick: () => updateUiColor(themeKey, color),
                style: S.colorSwatch(color, uiColors[themeKey] === color),
              }),
            ),
          ),
        )
      }

      const currentRoot = rootDirRef.current || state?.projectDir || ''
      const visibleRecent = recentFiles
        .filter((entry) => entry.rootDir === currentRoot)
        .slice(0, 6)

      const tabBar =
        openTabs.length === 0
          ? null
          : h(
              'div',
              { style: S.editorTabs },
              ...openTabs.map((path) => {
                const active = path === current
                const tabDirty = active ? dirty : buffersRef.current.get(path)?.dirty === true
                const name = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path
                return h(
                  'span',
                  { key: path, style: S.tabWrapper },
                  h(
                    'button',
                    {
                      type: 'button',
                      title: path,
                      onClick: () => void openFile(path),
                      style: S.tab(active),
                    },
                    tabDirty ? '● ' : '',
                    name,
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      title: t('closeTab'),
                      'aria-label': t('closeTab'),
                      onClick: () => void closeTab(path),
                      style: S.tabClose,
                    },
                    '×',
                  ),
                )
              }),
            )

      const welcomePanel = h(
        'div',
        { style: S.welcome },
        h('div', { style: S.welcomeTitle }, t('welcomeTitle')),
        h('div', { style: S.welcomeSubtitle }, t('welcomeSubtitle')),
        h(
          'div',
          { style: S.welcomeOpenRow },
          h('input', {
            value: welcomePath,
            placeholder: t('welcomePathPlaceholder'),
            onChange: (event) => setWelcomePath(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void openWelcomePath()
              }
            },
            style: { ...INPUT, flex: 1, minWidth: 180 },
          }),
          h(Btn, { primary: true, onClick: () => void openWelcomePath() }, t('open')),
          h(Btn, { onClick: () => void pickWelcomeFolder() }, t('chooseFolder')),
        ),
        h(
          'div',
          {
            style: {
              marginTop: 18,
              marginBottom: 4,
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--dsw-alias-label-secondary)',
            },
          },
          t('recentFiles'),
        ),
        visibleRecent.length === 0
          ? h('div', { style: { ...S.meta, padding: '6px 0' } }, t('noRecentFiles'))
          : h(
              'div',
              { style: S.recentGrid },
              ...visibleRecent.map((entry) =>
                h(
                  'button',
                  {
                    key: `${entry.rootDir}|${entry.path}`,
                    type: 'button',
                    title: entry.path,
                    onClick: () => void openFile(entry.path),
                    style: S.recentCard,
                  },
                  h('div', { style: S.recentName }, entry.name),
                  h('div', { style: S.recentPath }, entry.path),
                  h('div', { style: S.recentPreview }, entry.preview === '' ? '—' : entry.preview),
                  h(
                    'div',
                    { style: S.recentMeta },
                    entry.mtimeMs > 0 ? new Date(entry.mtimeMs).toLocaleString() : '',
                  ),
                ),
              ),
            ),
      )

      return h(
        'div',
        {
          style: {
            ...S.root,
            '--dsh-ink-accent': accent,
            '--dsh-ink-accent-contrast': accentContrast,
            '--dsh-ink-fold-highlight': foldHighlight,
          },
          ref: rootRef,
        },
        h('style', { key: 'ink-theme' }, HL_STYLES),
        railPlacement === 'left'
          ? h(
              'div',
              { style: { ...S.header, justifyContent: 'flex-end' } },
              titleGroup,
            )
          : null,
        railPlacement === 'top'
          ? h(
              'div',
              { key: 'action-bar', className: 'dsh-ink-topbar', style: S.actionBar },
              dragHandle,
              ...actionButtons,
              appearanceButton,
              interfaceButton,
              h('span', { style: { flex: 1, minWidth: 8 } }),
              titleGroup,
            )
          : null,
        dirEditorOpen === true
          ? h(
              'div',
              { style: S.dirBar },
              h('span', { style: S.dirLabel }, t('switchDir')),
              h('input', {
                autoFocus: true,
                value: dirDraft,
                placeholder: 'D:\\path\\to\\project',
                spellCheck: false,
                onChange: (event) => setDirDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void submitDir()
                  }
                  if (event.key === 'Escape') setDirEditorOpen(false)
                },
                style: { ...INPUT, flex: 1, minWidth: 0 },
              }),
              h(Btn, { primary: true, onClick: submitDir, disabled: busy !== '' }, t('ok')),
              h(Btn, { onClick: browseForDir, disabled: busy !== '' }, t('browse')),
              state?.defaultProjectDir
                ? h(
                    Btn,
                    { onClick: () => switchRoot(''), title: t('useDefault') },
                    t('useDefault'),
                  )
                : null,
              h(Btn, { onClick: () => setDirEditorOpen(false) }, t('cancel')),
            )
          : null,
        stale === true
          ? h(
              'div',
              { style: S.banner },
              h('span', { style: { color: 'var(--dsw-alias-state-warn-primary)' } }, t('staleTitle')),
              h('span', { style: { flex: 1, fontSize: 12 } }, t('staleBody')),
              h(Btn, { onClick: () => save(true), disabled: busy !== '' }, t('overwrite')),
              h(Btn, { onClick: () => openFile(current, true), disabled: busy !== '' }, t('reloadFromDisk')),
            )
          : null,
        pendingRestore !== null && pendingRestore.path === current && !dirty
          ? h(
              'div',
              { style: S.banner },
              h(
                'span',
                { style: { color: 'var(--dsw-alias-state-warn-primary)' } },
                t('restoreTitle'),
              ),
              h(
                'span',
                { style: { flex: 1, fontSize: 12 } },
                `${t('restoreBody')} ${new Date(pendingRestore.savedAt).toLocaleString()}`,
              ),
              h(Btn, { primary: true, onClick: restoreBackup }, t('restoreApply')),
              h(Btn, { onClick: discardRestore }, t('restoreKeep')),
            )
          : null,
        notice !== ''
          ? h('div', { style: S.notice }, notice)
          : null,
        error !== ''
          ? h('div', { style: { ...S.notice, color: 'var(--dsw-alias-state-error-primary)' } }, error)
          : null,
        h(
          'div',
          { style: S.body },
          railPlacement === 'left'
            ? h(
                'div',
                { key: 'action-rail', style: S.actionRail, className: 'dsh-ink-rail' },
                dragHandle,
                ...actionButtons,
                h('span', { style: { flex: 1 } }),
                appearanceButton,
                interfaceButton,
              )
            : null,
          h(
            'aside',
            {
              style: {
                ...S.rail,
                width: leftWidth,
                flex: `0 0 ${leftWidth}px`,
                position: 'relative',
                display: leftOpen ? 'flex' : 'none',
              },
            },
            h(
              'div',
              { style: S.railHead },
              h('span', { style: S.railTitle }, t('files')),
              h('span', { style: S.spacer }),
              h(Btn, { onClick: openCreate, style: { height: 22, padding: '0 8px' } }, t('newFile')),
              h(
                Btn,
                {
                  onClick: () => {
                    void refreshState(false)
                    void loadListing(subdir)
                  },
                  style: { height: 22, padding: '0 8px' },
                },
                t('refresh'),
              ),
            ),
            h(
              'div',
              { style: S.crumb, title: state?.projectDir ?? '' },
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => void goTo(''),
                  style: S.crumbLink(subdir === ''),
                },
                t('rootFolder'),
              ),
              ...segments.map((segment, index) =>
                h(
                  'span',
                  { key: `${index}:${segment}`, style: { display: 'inline-flex', alignItems: 'center' } },
                  h('span', { style: S.crumbSep }, '/'),
                  h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => void goTo(segments.slice(0, index + 1).join('/')),
                      style: S.crumbLink(index === segments.length - 1),
                    },
                    segment,
                  ),
                ),
              ),
            ),
            createOpen === true
              ? h(
                  'div',
                  { style: { ...S.createRow, flexDirection: 'column', alignItems: 'stretch' } },
                  h(
                    'div',
                    { style: { display: 'flex', gap: 4 } },
                    h(
                      'select',
                      {
                        value: createKind,
                        title: t('createKindHint'),
                        onChange: (event) =>
                          setCreateKind(event.target.value === 'folder' ? 'folder' : 'file'),
                        style: {
                          ...INPUT,
                          flex: '0 0 74px',
                          width: 74,
                          padding: '0 2px',
                          fontSize: 11,
                        },
                      },
                      h('option', { value: 'file' }, t('createFile')),
                      h('option', { value: 'folder' }, t('createFolder')),
                    ),
                    h('input', {
                      autoFocus: true,
                      value: createDraft,
                      placeholder:
                        createKind === 'folder' ? t('newFolderPrompt') : t('newFilePrompt'),
                      spellCheck: false,
                      onChange: (event) => setCreateDraft(event.target.value),
                      onKeyDown: (event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void submitCreate()
                        }
                        if (event.key === 'Escape') setCreateOpen(false)
                      },
                      style: { ...INPUT, flex: 1, minWidth: 0 },
                    }),
                  ),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 4, justifyContent: 'flex-end' } },
                    h(Btn, { primary: true, onClick: submitCreate }, t('ok')),
                    h(Btn, { onClick: () => setCreateOpen(false) }, t('cancel')),
                  ),
                )
              : null,
            h(
              'div',
              { style: S.fileList },
              state === null || listing === null
                ? h('div', { style: { ...S.meta, padding: 8 } }, t('loading'))
                : (() => {
                    const rows = []
                    if (subdir !== '') {
                      rows.push(
                        h(
                          'button',
                          {
                            key: 'up',
                            type: 'button',
                            onClick: () => void goTo(listing.parent ?? ''),
                            style: S.fileRow(false),
                          },
                          `↑ ${t('up')}`,
                        ),
                      )
                    }
                    for (const folder of listing.folders ?? []) {
                      rows.push(
                        h(
                          'button',
                          {
                            key: `d:${folder.path}`,
                            type: 'button',
                            title: folder.path,
                            onClick: () => void goTo(folder.path),
                            style: S.fileRow(false),
                          },
                          `▸ ${folder.name}`,
                        ),
                      )
                    }
                    for (const file of listing.files ?? []) {
                      rows.push(
                        h(
                          'button',
                          {
                            key: `f:${file.path}`,
                            type: 'button',
                            title: `${file.path} · ${file.size} B`,
                            ref: file.path === current ? activeFileRef : undefined,
                            onClick: () => openFile(file.path, false),
                            style: S.fileRow(file.path === current),
                          },
                          file.name,
                        ),
                      )
                    }
                    if (rows.length === 0) {
                      return h(
                        'div',
                        { style: { ...S.meta, padding: 8, whiteSpace: 'normal' } },
                        t('noFiles'),
                      )
                    }
                    return rows
                  })(),
            ),
          ),
          h(
            'div',
            {
              key: 'left-resizer',
              className: 'dsh-ink-resizer',
              title: t('dragResize'),
              onMouseDown: (event) => startResize('left', event),
              onDoubleClick: () => resetWidth('left'),
              style: S.resizerStrip,
            },
            h(
              'button',
              {
                type: 'button',
                title: leftOpen ? t('collapseFiles') : t('expandFiles'),
                onMouseDown: (event) => event.stopPropagation(),
                onDoubleClick: (event) => event.stopPropagation(),
                onClick: toggleLeft,
                style: S.resizerButton,
              },
              leftOpen ? '◀' : '▶',
            ),
          ),
          h(
            'section',
            { style: S.editorCol },
            current === ''
              ? welcomePanel
              : h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { style: S.editorHead },
              tabBar,
              h(
                'span',
                {
                  style: {
                    flex: '0 0 auto',
                    color: dirty ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-secondary)',
                  },
                },
                dirty ? t('unsaved') : t('savedState'),
              ),
              foldedSections.size > 0
                ? h(
                    'span',
                    {
                      style: {
                        flex: '0 0 auto',
                        color: 'var(--dsh-ink-fold-highlight)',
                      },
                    },
                    `${t('foldedActive')} ${foldedSections.size}`,
                  )
                : null,
              foldedSections.size > 0
                ? h(
                    Btn,
                    {
                      onClick: () => setFoldedSections(new Set()),
                      style: { height: 22, padding: '0 8px', flex: '0 0 auto' },
                    },
                    t('foldExpandAll'),
                  )
                : null,
              h(
                'select',
                {
                  value: wrapMode,
                  title: t('wrapHint'),
                  onChange: (event) => {
                    const value = event.target.value === 'auto' ? 'auto' : 'preview'
                    setWrapMode(value)
                    writeStorage(WRAP_KEY, value)
                  },
                  style: {
                    flex: '0 0 auto',
                    height: 22,
                    padding: '0 4px',
                    border: '1px solid var(--dsw-alias-border-l1)',
                    borderRadius: 6,
                    background: 'var(--dsw-alias-bg-layer-1)',
                    color: 'var(--dsw-alias-label-primary)',
                    font: 'inherit',
                    fontSize: 11,
                    outline: 'none',
                  },
                },
                h('option', { value: 'preview' }, t('wrapPreview')),
                h('option', { value: 'auto' }, t('wrapAuto')),
              ),
              h(
                'span',
                {
                  style: { display: 'inline-flex', alignItems: 'center', gap: 2, flex: '0 0 auto' },
                  title: t('zoomHint'),
                },
                h(
                  Btn,
                  { onClick: () => changeZoom(-ZOOM_STEP), style: { height: 22, padding: '0 6px' } },
                  'A−',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: resetZoom,
                    title: t('resetZoom'),
                    style: { ...BTN, height: 22, padding: '0 4px', minWidth: 44 },
                  },
                  `${Math.round(zoom * 100)}%`,
                ),
                h(
                  Btn,
                  { onClick: () => changeZoom(ZOOM_STEP), style: { height: 22, padding: '0 6px' } },
                  'A＋',
                ),
              ),
            ),
            h(
              'div',
              {
                style:
                  wrapMaxWidth === undefined
                    ? S.editorWrap
                    : {
                        ...S.editorWrap,
                        width: '100%',
                        maxWidth: wrapMaxWidth,
                        margin: '0 auto',
                      },
              },
              foldEnabled && hasFoldable
                ? h(
                    'div',
                    { ref: foldMarkerScrollRef, style: S.foldMarkerCol },
                    h(
                      'div',
                      {
                        style: {
                          position: 'relative',
                          width: '100%',
                          height:
                            16 +
                            (wrapInfo.visualLines ?? 0) * lineHeight +
                            EDITOR_BOTTOM_SPACE +
                            40,
                        },
                      },
                      ...foldHeaders.map((line) => {
                        const displayLine = foldView.displayByOriginal.get(line)
                        if (displayLine === undefined) return null
                        const folded = foldedSections.has(line)
                        return h(
                          'button',
                          {
                            key: line,
                            type: 'button',
                            className: 'dsh-ink-fold-marker',
                            title: t('foldMarkersHint'),
                            'aria-label': t('foldMarkersHint'),
                            onClick: () => toggleFoldSection(line),
                            style: {
                              position: 'absolute',
                              left: 0,
                              top:
                                8 +
                                (wrapInfo.starts[displayLine - 1] ?? displayLine - 1) *
                                  lineHeight,
                              width: '100%',
                              height: lineHeight,
                              padding: 0,
                              border: 'none',
                              background: 'transparent',
                              color: folded
                                ? 'var(--dsh-ink-fold-highlight)'
                                : 'var(--dsw-alias-label-secondary)',
                              cursor: 'pointer',
                              fontSize: 16,
                              lineHeight: `${lineHeight}px`,
                              textAlign: 'center',
                            },
                          },
                          folded ? '▸' : '▾',
                        )
                      }),
                    ),
                  )
                : null,
              h(
                'pre',
                {
                  ref: gutterRef,
                  style: {
                    ...S.gutter,
                    width: gutterWidth,
                    flex: `0 0 ${gutterWidth}px`,
                    fontSize,
                    lineHeight: `${lineHeight}px`,
                    paddingBottom: 8 + EDITOR_BOTTOM_SPACE,
                  },
                },
                wrapInfo.text,
              ),
              h(
                'div',
                { style: S.editorPane },
                h('div', {
                  ref: mirrorRef,
                  'aria-hidden': true,
                  style: {
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: contentWidth,
                    visibility: 'hidden',
                    pointerEvents: 'none',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-all',
                    tabSize: 2,
                    fontFamily: FONT_STACK,
                    fontSize,
                    lineHeight: `${lineHeight}px`,
                    boxSizing: 'border-box',
                    margin: 0,
                    padding: 0,
                    border: 'none',
                    zIndex: -1,
                  },
                }),
                h(
                  'div',
                  {
                    ref: bandScrollRef,
                    'aria-hidden': true,
                    style: {
                      position: 'absolute',
                      inset: 0,
                      right: EDITOR_SCROLLBAR_INSET,
                      overflow: 'hidden',
                      zIndex: 0,
                      pointerEvents: 'none',
                    },
                  },
                  h(
                    'div',
                    {
                      style: {
                        position: 'relative',
                        width: '100%',
                        height:
                          16 +
                          (wrapInfo.visualLines ?? 0) * lineHeight +
                          EDITOR_BOTTOM_SPACE +
                          40,
                      },
                    },
                    ...editorBands.map((band) =>
                      h('div', {
                        key: band.key,
                        style: {
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          top: band.top,
                          height: band.height,
                          background: band.background,
                          borderLeft: band.borderLeft,
                          borderRadius: 3,
                        },
                      }),
                    ),
                  ),
                ),
                h('pre', {
                  ref: highlightRef,
                  className: 'dsh-ink-hl',
                  'aria-hidden': true,
                  style: {
                    fontSize,
                    lineHeight: `${lineHeight}px`,
                    right: EDITOR_SCROLLBAR_INSET,
                    paddingRight: 10 + scrollbarWidth,
                    paddingBottom: 8 + EDITOR_BOTTOM_SPACE,
                    visibility: composing || !highlightEnabled ? 'hidden' : 'visible',
                  },
                  dangerouslySetInnerHTML: { __html: `\u200b${highlightHtml}\u200b` },
                }),
                h('textarea', {
                  ref: taRef,
                  className: 'dsh-ink-editor',
                  value: viewContent,
                  placeholder: t('selectFile'),
                  spellCheck: false,
                  wrap: 'soft',
                  disabled: !hasFile,
                  onChange: (event) => {
                    if (foldedSections.size > 0) {
                      handleFoldedChange(event)
                      return
                    }
                    pushHistory('type')
                    setContent(event.target.value)
                    setDirty(true)
                    if (event.nativeEvent !== null && event.nativeEvent !== undefined && event.nativeEvent.isComposing) {
                      closeCompletion()
                      return
                    }
                    updateCompletions()
                  },
                  onCompositionStart: () => {
                    setComposing(true)
                    closeCompletion()
                  },
                  onCompositionEnd: () => {
                    setComposing(false)
                    requestAnimationFrame(updateCompletions)
                  },
                  onSelect: (event) => {
                    syncCaretFromTextarea(event)
                    updateCompletions()
                  },
                  onClick: (event) => {
                    syncCaretFromTextarea(event)
                    updateCompletions()
                  },
                  onKeyUp: (event) => {
                    syncCaretFromTextarea(event)
                    updateCompletions()
                  },
                  onScroll: (event) => {
                    setShowBackToTop(event.target.scrollTop > 200)
                    syncCaretFromTextarea(event)
                    syncHighlightScroll()
                    setCompletion((previous) => {
                      if (previous === null) return previous
                      const place = placeCompletion(previous.caret)
                      return { ...previous, left: place.left, top: place.top }
                    })
                  },
                  onBlur: () => closeCompletion(),
                  onKeyDown: onEditorKeyDown,
                  style: {
                    ...S.textarea,
                    position: 'absolute',
                    inset: 0,
                    right: EDITOR_SCROLLBAR_INSET,
                    width: 'auto',
                    height: '100%',
                    zIndex: 1,
                    background: 'transparent',
                    fontSize,
                    lineHeight: `${lineHeight}px`,
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-all',
                    overflowX: 'hidden',
                    paddingBottom: 8 + EDITOR_BOTTOM_SPACE,
                    color:
                      composing || !highlightEnabled
                        ? 'var(--dsw-alias-label-primary)'
                        : 'transparent',
                    WebkitTextFillColor:
                      composing || !highlightEnabled
                        ? 'var(--dsw-alias-label-primary)'
                        : 'transparent',
                    caretColor: 'var(--dsw-alias-label-primary)',
                  },
                }),
                completion !== null
                  ? h(
                      'div',
                      {
                        key: 'completion',
                        ref: completionListRef,
                        role: 'listbox',
                        style: {
                          position: 'absolute',
                          left: completion.left,
                          top: completion.top,
                          zIndex: 30,
                          width: 250,
                          maxHeight: 190,
                          overflowY: 'auto',
                          padding: 4,
                          borderRadius: 8,
                          border: '1px solid var(--dsw-alias-border-l1)',
                          background: 'var(--dsw-alias-bg-overlay)',
                          boxShadow: '0 10px 24px rgba(0, 0, 0, .18)',
                        },
                      },
                      completion.items.map((item, index) =>
                        h(
                          'div',
                          {
                            key: `${item.kind}:${item.label}`,
                            role: 'option',
                            'aria-selected': index === completion.index,
                            onMouseDown: (event) => {
                              event.preventDefault()
                              acceptCompletion(item)
                            },
                            onMouseEnter: () =>
                              setCompletion((previous) =>
                                previous === null ? previous : { ...previous, index },
                              ),
                            style: {
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '4px 8px',
                              borderRadius: 5,
                              cursor: 'pointer',
                              background:
                                index === completion.index
                                  ? 'var(--dsw-alias-bg-layer-2)'
                                  : 'transparent',
                            },
                          },
                          h(
                            'span',
                            {
                              style: {
                                flex: 1,
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                fontFamily: FONT_STACK,
                                fontSize: 12,
                              },
                            },
                            item.label,
                          ),
                          h(
                            'span',
                            {
                              style: {
                                flex: '0 0 auto',
                                fontSize: 10,
                                color: 'var(--dsw-alias-label-secondary)',
                              },
                            },
                            item.kindLabel,
                          ),
                        ),
                      ),
                    )
                  : null,
                showBackToTop
                  ? h(
                      'button',
                      {
                        key: 'back-to-top',
                        type: 'button',
                        className: 'dsh-ink-backtop',
                        title: t('backToTop'),
                        'aria-label': t('backToTop'),
                        onClick: scrollEditorToTop,
                        style: S.backTop,
                      },
                      h(ActionIcon, { name: 'arrowUp', size: 16 }),
                    )
                  : null,
              ),
            ),
            h(
              'div',
              { style: S.issuePanel },
              h(
                'div',
                {
                  style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '2px 0' },
                  onClick: () => setShowIssues(!showIssues),
                },
                h('span', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } }, `${t('issues')} (${issues.length})`),
                h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, showIssues ? '▾' : '▸'),
              ),
              showIssues === true && issues.length > 0
                ? issues.slice(0, 30).map((issue, index) =>
                    h(
                      'div',
                      {
                        key: `${index}-${issue.line}`,
                        style: {
                          ...S.issueRow,
                          color:
                            issue.severity === 'error'
                              ? 'var(--dsw-alias-state-error-primary)'
                              : 'var(--dsw-alias-state-warn-primary)',
                        },
                        onClick: () => jumpToLine(issue.line),
                      },
                      h('span', { style: { flex: '0 0 64px', color: 'var(--dsw-alias-label-secondary)' } },
                        issue.line > 0 ? `${t('line')} ${issue.line}` : t('issueNone')),
                      h('span', { style: { flex: 1, wordBreak: 'break-word' } }, issue.text),
                    ),
                  )
                : null,
              showIssues === true && issues.length === 0
                ? h('div', { style: { ...S.meta, padding: '2px 0' } }, t('noIssues'))
                : null,
            ),
              ),
          ),
          previewOpen
            ? h(
                'aside',
                { style: S.previewPane },
                h(
                  'div',
                  { style: S.previewHead },
                  h('span', { style: { fontSize: 12, fontWeight: 600 } }, t('preview')),
                  h(
                    'span',
                    {
                      style: {
                        ...S.meta,
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                      title: current,
                    },
                    current,
                  ),
                  previewLoading ? h('span', { style: S.meta }, t('previewLoading')) : null,
                  h(
                    Btn,
                    { onClick: () => void startPreview(), disabled: previewLoading || !hasFile },
                    t('previewRestart'),
                  ),
                  h(Btn, { onClick: closePreview, style: { padding: '0 6px' } }, '×'),
                ),
                h(
                  'div',
                  { ref: previewBodyRef, style: S.previewBody },
                  previewError !== ''
                    ? h(
                        'div',
                        {
                          style: {
                            color: 'var(--dsw-alias-state-error-primary)',
                            fontSize: 12,
                            whiteSpace: 'pre-wrap',
                            marginBottom: 8,
                          },
                        },
                        previewError,
                      )
                    : null,
                  previewLines.length > 0
                    ? h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column' } },
                        ...previewLines
                          .slice(0, previewRevealed)
                          .map((line, index, shown) =>
                            h(
                              'div',
                              {
                                key: line.id,
                                className: 'dsh-ink-preview-line',
                                style:
                                  line.kind === 'variable'
                                    ? {
                                        ...S.previewVariable,
                                        borderLeftColor:
                                          line.scope === 'global'
                                            ? 'var(--dsh-ink-accent)'
                                            : 'var(--dsw-alias-state-success-primary, #16a34a)',
                                        opacity: index === shown.length - 1 ? 1 : 0.45,
                                      }
                                    : {
                                        opacity: index === shown.length - 1 ? 1 : 0.45,
                                        whiteSpace: 'pre-wrap',
                                        marginBottom: 8,
                                      },
                              },
                              line.text,
                            ),
                          ),
                      )
                    : null,
                  !previewLoading && !previewRevealing && previewChoices.length > 0
                    ? h(
                        'div',
                        {
                          style: {
                            marginTop: 10,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 5,
                          },
                        },
                        ...previewChoices.map((choice) =>
                          h(
                            'button',
                            {
                              key: choice.index,
                              type: 'button',
                              onClick: () => void choosePreview(choice.index),
                              style: {
                                textAlign: 'left',
                                padding: '6px 9px',
                                borderRadius: 6,
                                border: '1px solid var(--dsw-alias-border-l1)',
                                background: 'var(--dsw-alias-bg-layer-1)',
                                color: 'var(--dsw-alias-label-primary)',
                                cursor: 'pointer',
                                font: 'inherit',
                                fontSize: 12,
                              },
                            },
                            choice.text,
                          ),
                        ),
                      )
                    : null,
                  !previewLoading &&
                  !previewRevealing &&
                  previewEnded &&
                  previewError === ''
                    ? h(
                        'div',
                        {
                          style: {
                            marginTop: 10,
                            fontSize: 11,
                            textAlign: 'center',
                            color: 'var(--dsw-alias-label-secondary)',
                          },
                        },
                        t('previewEnd'),
                      )
                    : null,
                ),
                previewVariables.length > 0
                  ? h(
                      'div',
                      { style: S.previewVariables },
                      h(
                        'div',
                        {
                          style: S.previewVariablesHead,
                          onClick: () => setPreviewVariablesOpen((previous) => !previous),
                          title: t('toggleVariables'),
                        },
                        h('span', null, t('variables')),
                        h(
                          'span',
                          { style: { marginLeft: 'auto', fontSize: 10 } },
                          previewVariablesOpen ? '▾' : '▸',
                        ),
                      ),
                      previewVariablesOpen
                        ? h(
                            'div',
                            { style: S.previewVariablesBody },
                            ...['global', 'current'].map((scope) => {
                              const list = previewVariables.filter(
                                (item) => item.scope === scope,
                              )
                              if (list.length === 0) return null
                              return h(
                                'div',
                                { key: scope, style: S.previewVariableGroup },
                                h(
                                  'div',
                                  { style: S.previewVariableGroupLabel },
                                  scope === 'global'
                                    ? t('variableGlobal')
                                    : t('variableCurrent'),
                                ),
                                ...list.map((item) =>
                                  h(
                                    'div',
                                    {
                                      key: `${scope}:${item.name}`,
                                      style: S.previewVariableRow,
                                    },
                                    h(
                                      'span',
                                      { style: S.previewVariableName, title: item.name },
                                      item.name,
                                    ),
                                    h(
                                      'span',
                                      { style: S.previewVariableValue, title: item.value },
                                      `= ${item.value}`,
                                    ),
                                  ),
                                ),
                              )
                            }),
                          )
                        : null,
                    )
                  : null,
              )
            : null,
          h(
            'div',
            {
              key: 'right-resizer',
              className: 'dsh-ink-resizer',
              title: t('dragResize'),
              onMouseDown: (event) => startResize('right', event),
              onDoubleClick: () => resetWidth('right'),
              style: S.resizerStrip,
            },
            h(
              'button',
              {
                type: 'button',
                title: rightOpen ? t('collapseComposer') : t('expandComposer'),
                onMouseDown: (event) => event.stopPropagation(),
                onDoubleClick: (event) => event.stopPropagation(),
                onClick: toggleRight,
                style: S.resizerButton,
              },
              rightOpen ? '▶' : '◀',
            ),
          ),
          h(
            'aside',
            {
              style: {
                ...S.composer,
                width: rightWidth,
                flex: `0 0 ${rightWidth}px`,
                position: 'relative',
                display: rightOpen ? 'flex' : 'none',
              },
            },
            h('div', { style: S.sectionLabel }, t('composerTitle')),
            h('textarea', {
              rows: 2,
              value: text,
              placeholder: t('lineTextPlaceholder'),
              onChange: (event) => setText(event.target.value),
              style: { ...INPUT, resize: 'vertical', minHeight: 48, fontFamily: 'inherit', lineHeight: '18px' },
            }),
            h(
              'select',
              { value: lineKind, onChange: (event) => setLineKind(event.target.value), style: INPUT },
              h('option', { value: 'line' }, t('kindLine')),
              h('option', { value: 'choiceStar' }, t('kindChoiceStar')),
              h('option', { value: 'choicePlus' }, t('kindChoicePlus')),
              h('option', { value: 'divert' }, t('kindDivert')),
            ),
            lineKind === 'divert' || lineKind === 'choiceStar' || lineKind === 'choicePlus'
              ? h('input', {
                  value: target,
                  placeholder: t('targetPlaceholder'),
                  onChange: (event) => setTarget(event.target.value),
                  style: INPUT,
                  title: t('target'),
                })
              : null,
            h('div', { style: S.sectionLabel }, t('tagsTitle')),
            ...tagKeys.map((key) =>
              h(
                'div',
                { key, style: S.tagRow },
                h('span', { style: S.tagKey, title: `#${key}` }, `#${key}`),
                h(
                  'select',
                  {
                    value: selected[key] ?? NONE,
                    onChange: (event) => {
                      const value = event.target.value
                      setSelected({ ...selected, [key]: value })
                      if (value !== NONE && value !== EMPTY) setCustom({ ...custom, [key]: '' })
                    },
                    style: { ...INPUT, flex: 1, minWidth: 0 },
                  },
                  h('option', { value: NONE }, t('tagNone')),
                  h('option', { value: EMPTY }, t('tagEmpty')),
                  ...valuesOf(vocab, customTags, key).map((value) => h('option', { key: value, value }, value)),
                ),
                h('input', {
                  value: custom[key] ?? '',
                  placeholder: t('tagCustom'),
                  onChange: (event) => setCustom({ ...custom, [key]: event.target.value }),
                  style: { ...INPUT, width: 92, flex: '0 0 92px' },
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    title: t('addTag'),
                    onClick: () => rememberTag(key),
                    style: { ...BTN, width: 24, padding: 0, height: 26, flex: '0 0 24px' },
                  },
                  '＋',
                ),
              ),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 6 } },
              h('input', {
                value: newKey,
                placeholder: t('addKeyPlaceholder'),
                onChange: (event) => setNewKey(event.target.value),
                style: { ...INPUT, flex: 1, minWidth: 0 },
                onKeyDown: (event) => {
                  if (event.key === 'Enter') addKey()
                },
              }),
              h(Btn, { onClick: addKey }, t('addKey')),
            ),
            h('div', { style: S.sectionLabel }, t('preview')),
            h(
              'div',
              {
                ref: previewRef,
                style: {
                  ...S.preview,
                  fontSize,
                  lineHeight: `${lineHeight}px`,
                },
              },
              previewLine === '' ? '—' : previewLine,
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 6 } },
              h(Btn, { primary: true, onClick: insertComposerLine, disabled: previewLine === '' || !hasFile }, t('insert')),
              h(Btn, { onClick: applyToCurrentLine, disabled: !hasFile }, t('applyTags')),
            ),
            h('div', { style: { ...S.sectionLabel, marginTop: 10 } }, t('presets')),
            h(
              'div',
              { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' } },
              ...composerPresets.presets.map((preset) => {
                const tags = presetTags(preset)
                return h(
                  'span',
                  {
                    key: preset.id,
                    style: {
                      display: 'inline-flex',
                      alignItems: 'stretch',
                      minWidth: 0,
                      maxWidth: '100%',
                    },
                  },
                  h(
                    'button',
                    {
                      type: 'button',
                      title:
                        tags === ''
                          ? t('applyPreset')
                          : `${t('applyPreset')} · ${tags}`,
                      onClick: () => applyComposerPreset(preset),
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 2,
                        padding: '3px 8px',
                        borderRadius: 6,
                        border: '1px solid var(--dsw-alias-border-l1)',
                        background:
                          composerPresets.activeId === preset.id
                            ? 'var(--dsh-ink-accent)'
                            : 'var(--dsw-alias-bg-layer-1)',
                        color:
                          composerPresets.activeId === preset.id
                            ? 'var(--dsh-ink-accent-contrast)'
                            : 'var(--dsw-alias-label-primary)',
                        cursor: 'pointer',
                        font: 'inherit',
                        fontSize: 11,
                        minWidth: 0,
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textAlign: 'left',
                      },
                    },
                    h(
                      'span',
                      {
                        style: {
                          fontWeight: 600,
                          maxWidth: '100%',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        },
                      },
                      preset.name,
                    ),
                    tags === ''
                      ? null
                      : h(
                          'span',
                          {
                            style: {
                              fontSize: 10,
                              opacity: 0.85,
                              maxWidth: '100%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            },
                          },
                          tags,
                        ),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      title: t('deletePreset'),
                      onClick: () => deleteComposerPreset(preset),
                      style: {
                        marginLeft: 2,
                        padding: '0 5px',
                        border: '1px solid var(--dsw-alias-border-l1)',
                        borderRadius: 6,
                        background: 'var(--dsw-alias-bg-layer-1)',
                        color: 'var(--dsw-alias-label-secondary)',
                        cursor: 'pointer',
                        font: 'inherit',
                        fontSize: 12,
                        alignSelf: 'stretch',
                      },
                    },
                    '×',
                  ),
                )
              }),
              h(
                Btn,
                {
                  onClick: addComposerPreset,
                  style: { height: 22, padding: '0 7px' },
                  title: t('addPreset'),
                },
                '+',
              ),
              h(
                Btn,
                {
                  onClick: saveComposerPreset,
                  style: { height: 22, padding: '0 7px' },
                  title: t('savePreset'),
                },
                t('savePreset'),
              ),
            ),
            h(
              'div',
              { style: { ...S.meta, whiteSpace: 'normal', marginTop: 4 } },
              t('presetHint'),
            ),
            h('div', { style: { ...S.meta, whiteSpace: 'normal', marginTop: 4 } }, t('footerHint')),
          ),
        ),
        h(
          'div',
          { style: S.footer },
          h('span', null, `${t('line')} ${caretLineNumber}, ${t('col')} ${caret.col}`),
          h('span', null, `${lineCount} ${t('line')} · ${content.length} ${t('chars')}`),
          h('span', null, `${Math.round(zoom * 100)}% · ${t('zoomHint')}`),
          h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, t('undoHint')),
          h('span', { style: S.spacer }),
          h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, state?.inkyExists === false ? t('inkyMissing') : ''),
        ),
        vocabOpen === true
          ? h(
              'div',
              {
                style: S.modalBackdrop,
                onMouseDown: (event) => {
                  if (event.target === event.currentTarget) setVocabOpen(false)
                },
              },
              h(
                'div',
                { style: S.modalCard },
                h(
                  'div',
                  { style: S.modalHead },
                  h('span', { style: { fontSize: 14, fontWeight: 600 } }, t('vocabTitle')),
                  h('span', { style: S.spacer }),
                  h(Btn, { onClick: () => setVocabOpen(false) }, t('close')),
                ),
                h(
                  'div',
                  { style: { ...S.meta, whiteSpace: 'normal', marginBottom: 10 } },
                  t('vocabHint'),
                ),
                ...tagKeys.map((key) => {
                  const scanned = vocab[key] ?? []
                  const customValues = (customTags[key] ?? []).filter(
                    (value) => !scanned.includes(value),
                  )
                  const isCustomKey = customKeys.includes(key)
                  const isDefault = DEFAULT_KEYS.includes(key)
                  const sourceLabel = isCustomKey
                    ? t('custom')
                    : isDefault
                      ? t('defaultKey')
                      : t('scannedKey')
                  return h(
                    'div',
                    {
                      key,
                      style: {
                        borderTop: '1px solid var(--dsw-alias-border-l1)',
                        padding: '8px 0',
                      },
                    },
                    h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                      h(
                        'span',
                        { style: { fontFamily: FONT_STACK, fontSize: 12, fontWeight: 600 } },
                        `#${key}`,
                      ),
                      h(
                        'span',
                        { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } },
                        sourceLabel,
                      ),
                      scanned.length > 0
                        ? h(
                            'span',
                            {
                              style: {
                                fontSize: 10,
                                color: 'var(--dsw-alias-label-secondary)',
                              },
                            },
                            `${scanned.length} ${t('fromFile')}`,
                          )
                        : null,
                      h('span', { style: S.spacer }),
                      isCustomKey
                        ? h(
                            Btn,
                            {
                              onClick: () => removeVocabKey(key),
                              style: { height: 20, padding: '0 6px', fontSize: 11 },
                            },
                            t('deleteKey'),
                          )
                        : null,
                    ),
                    h(
                      'div',
                      { style: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 } },
                      ...scanned.map((value) =>
                        h(
                          'span',
                          { key: `s:${value}`, title: t('fromFile'), style: S.vocabChip },
                          value,
                        ),
                      ),
                      ...customValues.map((value) =>
                        h(
                          'span',
                          {
                            key: `c:${value}`,
                            style: {
                              ...S.vocabChip,
                              borderColor: 'var(--dsw-alias-brand-primary)',
                            },
                          },
                          value,
                          h(
                            'button',
                            {
                              type: 'button',
                              title: t('removeValue'),
                              onClick: () => removeVocabValue(key, value),
                              style: {
                                border: 'none',
                                background: 'transparent',
                                color: 'inherit',
                                cursor: 'pointer',
                                padding: '0 0 0 4px',
                                font: 'inherit',
                                lineHeight: 1,
                              },
                            },
                            '×',
                          ),
                        ),
                      ),
                    ),
                    h(
                      'div',
                      { style: { display: 'flex', gap: 4, marginTop: 6 } },
                      h('input', {
                        value: vocabDrafts[key] ?? '',
                        placeholder: t('addValuePlaceholder'),
                        onChange: (event) => setVocabDraft(key, event.target.value),
                        onKeyDown: (event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            addVocabValue(key)
                          }
                        },
                        style: { ...INPUT, flex: 1, minWidth: 0 },
                      }),
                      h(Btn, { onClick: () => addVocabValue(key) }, t('addValue')),
                    ),
                  )
                }),
                h(
                  'div',
                  { style: { display: 'flex', gap: 6, marginTop: 12 } },
                  h('input', {
                    value: newKey,
                    placeholder: t('addKeyPlaceholder'),
                    onChange: (event) => setNewKey(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') addKey()
                    },
                    style: { ...INPUT, flex: 1, minWidth: 0 },
                  }),
                  h(Btn, { onClick: addKey }, t('addKey')),
                ),
              ),
            )
          : null,
        outlineOpen === true
          ? h(
              'div',
              {
                style: S.modalBackdrop,
                onMouseDown: (event) => {
                  if (event.target === event.currentTarget) closeOutline()
                },
              },
              h(
                'div',
                { style: { ...S.modalCard, width: 680 } },
                h(
                  'div',
                  { style: S.modalHead },
                  h('span', { style: { fontSize: 14, fontWeight: 600 } }, t('outlineTitle')),
                  h('span', { style: S.spacer }),
                  h(
                    Btn,
                    {
                      onClick: () => setOutlineNonce((value) => value + 1),
                      disabled: outlineLoading,
                    },
                    t('outlineRefresh'),
                  ),
                  h(Btn, { onClick: closeOutline }, t('close')),
                ),
                h(
                  'div',
                  { style: { ...S.meta, whiteSpace: 'normal', marginBottom: 8 } },
                  t('outlineHint'),
                ),
                outlineLoading
                  ? h('div', { style: { ...S.meta, padding: '8px 0' } }, t('outlineLoading'))
                  : outlineError !== ''
                    ? h(
                        'div',
                        {
                          style: {
                            ...S.meta,
                            padding: '8px 0',
                            color: 'var(--dsw-alias-state-error-primary)',
                          },
                        },
                        outlineError,
                      )
                    : outlineData === null || outlineData.files.length === 0
                      ? h('div', { style: { ...S.meta, padding: '8px 0' } }, t('outlineEmpty'))
                      : h(
                          'div',
                          null,
                          h(
                            'div',
                            { style: { ...S.meta, marginBottom: 8 } },
                            `${outlineTotals.files} ${t('outlineFiles')} · ${outlineTotals.knots} ${t('outlineKnots')} · ${outlineTotals.stitches} ${t('outlineStitches')} · ${outlineTotals.functions} ${t('outlineFunctions')}`,
                          ),
                          ...outlineData.files.map(renderOutlineFile),
                        ),
                outlineTruncated || outlineSkipped > 0
                  ? h(
                      'div',
                      {
                        style: {
                          ...S.meta,
                          marginTop: 8,
                          color: 'var(--dsw-alias-state-warn-primary)',
                        },
                      },
                      `${outlineSkipped > 0 ? `${outlineSkipped} ${t('outlineSkipped')} ` : ''}${outlineTruncated ? t('outlineTruncated') : ''}`,
                    )
                  : null,
              ),
            )
          : null,
        blueprintOpen === true
          ? h(
              'div',
              {
                style: S.modalBackdrop,
                onMouseDown: (event) => {
                  if (event.target === event.currentTarget) closeBlueprint()
                },
              },
              h(
                'div',
                { style: S.blueprintCard },
                h(
                  'div',
                  { style: S.modalHead },
                  h('span', { style: { fontSize: 14, fontWeight: 600 } }, t('blueprintTitle')),
                  h('span', { style: { ...S.meta, marginLeft: 8 } }, current),
                  h('span', { style: S.spacer }),
                  h(
                    Btn,
                    {
                      onClick: () =>
                        setBlueprintZoom((value) =>
                          Math.max(0.3, Math.round((value / 1.12) * 100) / 100),
                        ),
                    },
                    '−',
                  ),
                  h(
                    'span',
                    {
                      onClick: () => setBlueprintZoom(1),
                      title: t('blueprintZoomReset'),
                      style: {
                        ...S.meta,
                        minWidth: 40,
                        textAlign: 'center',
                        cursor: 'pointer',
                      },
                    },
                    `${Math.round(blueprintZoom * 100)}%`,
                  ),
                  h(
                    Btn,
                    {
                      onClick: () =>
                        setBlueprintZoom((value) =>
                          Math.min(2.5, Math.round(value * 1.12 * 100) / 100),
                        ),
                    },
                    '＋',
                  ),
                  h(
                    Btn,
                    {
                      onClick: () => {
                        setBlueprintPositions({})
                        setBlueprintSelection(new Set())
                      },
                    },
                    t('blueprintRelayout'),
                  ),
                  h(Btn, { onClick: closeBlueprint }, t('close')),
                ),
                h(
                  'div',
                  { style: { ...S.meta, marginBottom: 8 } },
                  t('blueprintHint'),
                ),
                blueprintData === null || blueprintData.nodes.length === 0
                  ? h('div', { style: { ...S.meta, padding: '8px 0' } }, t('blueprintEmpty'))
                  : h(
                      'div',
                      {
                        ref: blueprintCanvasRef,
                        style: S.blueprintCanvas,
                        onMouseDown: (event) => {
                          if (event.button === 1) startMiddlePan(event)
                        },
                        onAuxClick: (event) => {
                          if (event.button === 1) event.preventDefault()
                        },
                      },
                      h(
                        'div',
                        {
                          style: {
                            position: 'relative',
                            width: Math.round(blueprintWidth * blueprintZoom),
                            height: Math.round(blueprintHeight * blueprintZoom),
                          },
                        },
                        h(
                          'div',
                          {
                            onMouseDown: startMarquee,
                            style: {
                              position: 'absolute',
                              left: 0,
                              top: 0,
                              width: blueprintWidth,
                              height: blueprintHeight,
                              transform: `scale(${blueprintZoom})`,
                              transformOrigin: '0 0',
                              backgroundImage:
                                'radial-gradient(circle, rgba(140, 150, 165, 0.35) 1px, transparent 1px)',
                              backgroundSize: '22px 22px',
                            },
                          },
                          h(
                            'svg',
                            {
                              width: blueprintWidth,
                              height: blueprintHeight,
                              style: {
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                pointerEvents: 'none',
                              },
                            },
                            h(
                              'defs',
                              null,
                              h(
                                'marker',
                                {
                                  id: 'ink-bp-arrow',
                                  viewBox: '0 0 10 10',
                                  refX: 8,
                                  refY: 5,
                                  markerWidth: 6,
                                  markerHeight: 6,
                                  orient: 'auto-start-reverse',
                                },
                                h('path', {
                                  d: 'M 0 0 L 10 5 L 0 10 z',
                                  fill: 'var(--dsw-alias-label-secondary)',
                                }),
                              ),
                            ),
                            ...blueprintData.edges.map((edge, index) =>
                              h('path', {
                                key: `${edge.from}->${edge.to}:${index}`,
                                d: blueprintEdgePath(edge),
                                fill: 'none',
                                stroke: edge.unknown
                                  ? 'var(--dsw-alias-state-warn-primary)'
                                  : 'var(--dsw-alias-label-secondary)',
                                strokeOpacity: edge.unknown ? 0.85 : 0.45,
                                strokeWidth: 1.4,
                                strokeDasharray: edge.unknown ? '5 4' : undefined,
                                markerEnd: 'url(#ink-bp-arrow)',
                              }),
                            ),
                          ),
                          ...blueprintData.nodes.map((node) => {
                            const position =
                              blueprintPositions[node.id] ??
                              blueprintData.base[node.id] ?? { x: 0, y: 0 }
                            const accent = blueprintKindColor(node.kind)
                            const selected = blueprintSelection.has(node.id)
                            return h(
                              'div',
                              {
                                key: node.id,
                                onMouseDown: (event) => startBlueprintDrag(node, event),
                                onDoubleClick: () => {
                                  if (node.line > 0) {
                                    closeBlueprint()
                                    requestAnimationFrame(() => jumpToLine(node.line))
                                  }
                                },
                                style: {
                                  position: 'absolute',
                                  left: position.x,
                                  top: position.y,
                                  width: 190,
                                  borderRadius: 8,
                                  border: `1px solid ${
                                    selected
                                      ? 'var(--dsw-alias-brand-primary)'
                                      : node.kind === 'unknown'
                                        ? 'var(--dsw-alias-state-warn-primary)'
                                        : 'var(--dsw-alias-border-l1)'
                                  }`,
                                  boxShadow: selected
                                    ? '0 0 0 2px var(--dsw-alias-brand-primary), 0 6px 18px rgba(0, 0, 0, 0.22)'
                                    : '0 4px 12px rgba(0, 0, 0, 0.14)',
                                  background: 'var(--dsw-alias-bg-layer-1)',
                                  cursor: 'grab',
                                  userSelect: 'none',
                                },
                              },
                              h(
                                'div',
                                {
                                  style: {
                                    height: 26,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '0 8px',
                                    borderRadius: '8px 8px 0 0',
                                    background: accent,
                                    color: '#fff',
                                    fontSize: 10,
                                    fontWeight: 600,
                                  },
                                },
                                h(
                                  'span',
                                  {
                                    style: {
                                      flex: 1,
                                      minWidth: 0,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    },
                                  },
                                  node.label,
                                ),
                                h(
                                  'span',
                                  { style: { opacity: 0.85, whiteSpace: 'nowrap' } },
                                  node.kind,
                                ),
                              ),
                              h(
                                'div',
                                {
                                  style: {
                                    padding: '7px 10px 8px',
                                    fontSize: 10,
                                    color: 'var(--dsw-alias-label-secondary)',
                                  },
                                },
                                node.line > 0 ? `${t('line')} ${node.line}` : '—',
                              ),
                              h('span', {
                                style: {
                                  position: 'absolute',
                                  left: -5,
                                  top: 27,
                                  width: 10,
                                  height: 10,
                                  borderRadius: '50%',
                                  background: accent,
                                  border: '2px solid var(--dsw-alias-bg-base)',
                                },
                              }),
                              h('span', {
                                style: {
                                  position: 'absolute',
                                  right: -5,
                                  top: 27,
                                  width: 10,
                                  height: 10,
                                  borderRadius: '50%',
                                  background: accent,
                                  border: '2px solid var(--dsw-alias-bg-base)',
                                },
                              }),
                            )
                          }),
                          blueprintMarquee !== null
                            ? h('div', {
                                key: 'marquee',
                                style: {
                                  position: 'absolute',
                                  left: Math.min(blueprintMarquee.x1, blueprintMarquee.x2),
                                  top: Math.min(blueprintMarquee.y1, blueprintMarquee.y2),
                                  width: Math.abs(blueprintMarquee.x2 - blueprintMarquee.x1),
                                  height: Math.abs(blueprintMarquee.y2 - blueprintMarquee.y1),
                                  border: '1px dashed var(--dsw-alias-brand-primary)',
                                  background: 'rgba(59, 130, 246, 0.12)',
                                  pointerEvents: 'none',
                                },
                              })
                            : null,
                        ),
                      ),
                    ),
              ),
            )
          : null,
        appearanceOpen === true
          ? h(
              'div',
              {
                style: S.modalBackdrop,
                onMouseDown: (event) => {
                  if (event.target === event.currentTarget) setAppearanceOpen(false)
                },
              },
              h(
                'div',
                { style: { ...S.modalCard, width: 480 } },
                h(
                  'div',
                  { style: S.modalHead },
                  h('span', { style: { fontSize: 14, fontWeight: 600 } }, t('appearance')),
                  h('span', { style: S.spacer }),
                  h(Btn, { onClick: () => setAppearanceOpen(false) }, t('close')),
                ),
                appearanceColorRow('light', 'accentLight'),
                appearanceColorRow('dark', 'accentDark'),
                h(
                  'div',
                  { style: S.appearanceSection },
                  h('div', { style: S.appearanceLabel }, t('buttonStyle')),
                  h(
                    'div',
                    { style: S.appearanceRow },
                    h(
                      Btn,
                      {
                        onClick: () => setLabelModeAndStore('both'),
                        primary: labelMode === 'both',
                      },
                      t('styleBoth'),
                    ),
                    h(
                      Btn,
                      {
                        onClick: () => setLabelModeAndStore('icons'),
                        primary: labelMode === 'icons',
                      },
                      t('styleIcons'),
                    ),
                  ),
                ),
                h(
                  'div',
                  { style: S.appearanceSection },
                  h('div', { style: S.appearanceLabel }, t('language')),
                  h(
                    'div',
                    { style: S.appearanceRow },
                    h(
                      'select',
                      {
                        value: uiLang,
                        onChange: (event) => setUiLangAndStore(event.target.value),
                        style: S.languageSelect,
                      },
                      h('option', { value: 'auto' }, t('languageAuto')),
                      h('option', { value: 'zh' }, t('languageZh')),
                      h('option', { value: 'en' }, t('languageEn')),
                    ),
                  ),
                ),
                h(
                  'div',
                  { style: S.appearanceSection },
                  h('div', { style: S.appearanceLabel }, t('foldSection')),
                  h(
                    'div',
                    { style: S.appearanceRow },
                    h('span', { style: { flex: 1, fontSize: 12 } }, t('foldEnabled')),
                    h(
                      Btn,
                      {
                        onClick: () => setFoldEnabledAndStore(!foldEnabled),
                        primary: foldEnabled,
                      },
                      foldEnabled ? t('enabled') : t('disabled'),
                    ),
                  ),
                  h(
                    'div',
                    { style: S.appearanceRow },
                    h(
                      'span',
                      { style: { fontSize: 12, flex: '0 0 auto' } },
                      t('foldHighlight'),
                    ),
                    h('input', {
                      type: 'color',
                      value: foldHighlight,
                      onChange: (event) => setFoldHighlightAndStore(event.target.value),
                      style: S.colorInput,
                    }),
                    h('span', { style: S.appearanceHex }, foldHighlight),
                    ...PRESET_COLORS.map((color) =>
                      h('button', {
                        key: `fold-${color}`,
                        type: 'button',
                        title: color,
                        onClick: () => setFoldHighlightAndStore(color),
                        style: S.colorSwatch(color, foldHighlight === color),
                      }),
                    ),
                  ),
                  h(
                    'div',
                    {
                      style: {
                        fontSize: 11,
                        lineHeight: '16px',
                        color: 'var(--dsw-alias-label-secondary)',
                      },
                    },
                    t('foldMarkersHint'),
                  ),
                ),
                h(
                  'div',
                  { style: S.appearanceSection },
                  h('div', { style: S.appearanceLabel }, t('speakerColors')),
                  h(
                    'div',
                    { style: S.appearanceRow },
                    h(
                      'span',
                      { style: { fontSize: 12, flex: '0 0 auto' } },
                      t('speakerLabel'),
                    ),
                    h(
                      'select',
                      {
                        value: speakerColorActive,
                        onChange: (event) => setSpeakerColorTarget(event.target.value),
                        style: S.speakerSelect,
                      },
                      ...detectedSpeakers.map((speaker) =>
                        h(
                          'option',
                          {
                            key: speaker === '' ? '__blank__' : `speaker:${speaker}`,
                            value: speaker,
                          },
                          speaker === '' ? t('speakerBlank') : speaker,
                        ),
                      ),
                    ),
                  ),
                  h(
                    'div',
                    { style: S.appearanceRow },
                    h(
                      'span',
                      {
                        style: {
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontSize: 12,
                        },
                      },
                      speakerColorActive === ''
                        ? t('speakerBlank')
                        : speakerColorActive,
                    ),
                    h('input', {
                      type: 'color',
                      value:
                        speakerColors[speakerColorActive] ??
                        speakerDefaultHex(speakerColorActive),
                      onChange: (event) =>
                        setSpeakerColorAndStore(
                          speakerColorActive,
                          event.target.value,
                        ),
                      style: S.colorInput,
                    }),
                    h(
                      'span',
                      { style: S.appearanceHex },
                      speakerColors[speakerColorActive] ?? t('speakerDefault'),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        title: t('resetSpeakerColor'),
                        disabled: speakerColors[speakerColorActive] === undefined,
                        onClick: () => resetSpeakerColor(speakerColorActive),
                        style: {
                          ...S.colorReset,
                          opacity:
                            speakerColors[speakerColorActive] === undefined ? 0.4 : 1,
                        },
                      },
                      '↺',
                    ),
                  ),
                ),
                h(
                  'div',
                  { style: S.appearanceSection },
                  h(
                    'div',
                    { style: S.appearanceRow },
                    h('span', { style: { flex: 1, fontSize: 12 } }, t('bandTints')),
                    h(
                      Btn,
                      { onClick: () => setBandTintsAndStore(!bandTints), primary: bandTints },
                      bandTints ? t('enabled') : t('disabled'),
                    ),
                  ),
                  h(
                    'div',
                    { style: S.appearanceRow },
                    h(
                      'span',
                      { style: { fontSize: 12, flex: '0 0 auto' } },
                      t('bandStrength'),
                    ),
                    h('input', {
                      type: 'range',
                      min: 0.4,
                      max: 2,
                      step: 0.1,
                      value: bandStrength,
                      onChange: (event) =>
                        setBandStrengthAndStore(Number(event.target.value)),
                      style: S.rangeInput,
                    }),
                    h(
                      'span',
                      { style: S.appearanceHex },
                      `${Math.round(bandStrength * 100)}%`,
                    ),
                  ),
                ),
                h('div', { style: S.appearanceHint }, t('appearanceHint')),
                h(
                  'div',
                  { style: S.appearanceFooter },
                  h(Btn, { onClick: resetAppearance }, t('resetAppearance')),
                ),
              ),
            )
          : null,
        interfaceOpen === true
          ? h(
              'div',
              {
                style: S.modalBackdrop,
                onMouseDown: (event) => {
                  if (event.target === event.currentTarget) setInterfaceOpen(false)
                },
              },
              h(
                'div',
                { style: { ...S.modalCard, width: 460 } },
                h(
                  'div',
                  { style: S.modalHead },
                  h('span', { style: { fontSize: 14, fontWeight: 600 } }, t('interfaceButtons')),
                  h('span', { style: S.spacer }),
                  h(Btn, { onClick: () => setInterfaceOpen(false) }, t('close')),
                ),
                h(
                  'div',
                  {
                    style: {
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '4px 12px',
                    },
                  },
                  ...ACTION_BUTTONS.map((item) =>
                    h(
                      'label',
                      {
                        key: item.key,
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 12,
                          padding: '3px 0',
                          cursor: 'pointer',
                        },
                      },
                      h('input', {
                        type: 'checkbox',
                        checked: isButtonVisible(item.key),
                        onChange: (event) =>
                          setButtonVisible(item.key, event.target.checked),
                        style: { accentColor: 'var(--dsh-ink-accent)' },
                      }),
                      h('span', null, t(item.labelKey)),
                    ),
                  ),
                ),
                h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      gap: 6,
                      marginTop: 12,
                      justifyContent: 'flex-end',
                      flexWrap: 'wrap',
                    },
                  },
                  h(Btn, { onClick: () => setAllButtonsVisible(true) }, t('selectAll')),
                  h(Btn, { onClick: () => setAllButtonsVisible(false) }, t('selectNone')),
                  h(Btn, { onClick: resetButtonVisibility }, t('resetButtons')),
                ),
                h('div', { style: S.appearanceHint }, t('interfaceHint')),
              ),
            )
          : null,
        railDrop !== null
          ? h('div', {
              key: 'rail-drop',
              style: {
                position: 'absolute',
                ...(railDrop === 'top'
                  ? { left: 0, right: 0, top: 0, height: 70 }
                  : { left: 0, top: 0, bottom: 0, width: 70 }),
                border: '2px dashed #2563eb',
                background: 'rgba(37, 99, 235, 0.10)',
                borderRadius: 6,
                pointerEvents: 'none',
                zIndex: 500,
              },
            })
          : null,
      )
    }

    // ------------------------------------------------------------------- icon

    function InkIcon() {
      return h(
        'svg',
        {
          width: 18,
          height: 18,
          viewBox: '0 0 20 20',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('path', { d: 'M4 15.5c2.6-.6 3.9-2.2 4.9-4.3l2.3-4.6 1.4-1.3 1.3 1.3-1.3 1.4-4.6 2.3c-2.1 1-3.7 2.3-4.3 4.9z' }),
        h('path', { d: 'M5.3 14.3c.7-1.7 2-3 3.7-3.7' }),
        h('circle', { cx: 5.4, cy: 14.7, r: 1.2, fill: 'currentColor', stroke: 'none' }),
      )
    }

    // ------------------------------------------------------------------- apply

    return {
      inject: ['slots', 'locale', 'uiWorkspace', 'layout'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'zh', zh))
        ctx.effect(() => ctx.locale.register(NS, 'en', en))
        const translate = ctx.locale.bind(NS)
        baseTranslate = (key) => translate(key)

        const standalone = (() => {
          try {
            return new URLSearchParams(window.location.search).get('dsh-ink-window') === '1'
          } catch {
            return false
          }
        })()
        if (standalone) {
          ctx.effect(() => {
            let attempts = 0
            const timer = setInterval(() => {
              attempts += 1
              try {
                ctx.layout.selectPanel(PANEL_ID)
              } catch {
                // The panel list may not be ready yet; retry briefly.
              }
              if (attempts >= 10) clearInterval(timer)
            }, 300)
            return () => clearInterval(timer)
          })
        }

        ctx.slots.inject('main', () =>
          ctx.slots.inject('sidebar.panellist', () => {
            const stopMain = ctx.slots.register(
              {
                name: 'main',
                key: PANEL_ID,
                inject: () => ({ pickDirectory: () => ctx.uiWorkspace.pickDirectory() }),
              },
              InkPanel,
            )
            const stopIcon = ctx.slots.register(
              { name: 'sidebar.panellist', id: PANEL_ID, order: 60, label: () => t('rail') },
              InkIcon,
            )
            return () => {
              if (typeof stopIcon === 'function') stopIcon()
              if (typeof stopMain === 'function') stopMain()
            }
          }),
        )
      },
    }
  },
})
