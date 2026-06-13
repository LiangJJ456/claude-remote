package com.claude.remote.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claude.remote.data.Session
import com.claude.remote.net.ClientMsg
import com.claude.remote.net.HostMsg
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.filterIsInstance

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionListScreen(
    sessions: List<Session>,
    connState: String,
    incoming: Flow<HostMsg>,
    send: (ClientMsg) -> Unit,
    onOpen: (Session) -> Unit,
    onNew: (String) -> Unit,
    onSettings: () -> Unit,
) {
    var showNewDialog by remember { mutableStateOf(false) }

    Scaffold(
        topBar = { TopAppBar(title = { Text("会话 · $connState") }, actions = {
            TextButton(onClick = onSettings) { Text("设置") }
        }) },
        floatingActionButton = { FloatingActionButton(onClick = { showNewDialog = true }) { Text("+") } },
    ) { pad ->
        LazyColumn(Modifier.padding(pad).fillMaxSize()) {
            items(sessions, key = { it.id }) { s ->
                val clickable = !(s.state == "exited" && s.orphaned)
                ListItem(
                    headlineContent = { Text(s.name) },
                    supportingContent = { Text(s.cwd, maxLines = 1) },
                    trailingContent = {
                        val (label, color) = when (s.state) {
                            "working" -> "干活中" to Color(0xFF6EC1FF)
                            "waiting" -> "等输入" to Color(0xFFFFD866)
                            else -> (if (s.orphaned) "中断" else "已结束") to Color.Gray
                        }
                        Text(label, color = color)
                    },
                    modifier = if (clickable) Modifier.clickable { onOpen(s) } else Modifier,
                )
                HorizontalDivider()
            }
        }
    }

    if (showNewDialog) {
        DirectoryBrowserDialog(
            incoming = incoming,
            send = send,
            onConfirm = { cwd -> showNewDialog = false; onNew(cwd) },
            onDismiss = { showNewDialog = false },
        )
    }
}

/**
 * 目录浏览器：向宿主请求子目录列表，点进子目录逐级浏览，筛选框过滤当前层，选定即新建。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DirectoryBrowserDialog(
    incoming: Flow<HostMsg>,
    send: (ClientMsg) -> Unit,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var path by remember { mutableStateOf("") }
    var parent by remember { mutableStateOf("") }
    var entries by remember { mutableStateOf<List<String>>(emptyList()) }
    var filter by remember { mutableStateOf("") }

    // 收宿主的 dir 响应，更新当前目录与子目录
    LaunchedEffect(Unit) {
        send(ClientMsg.ListDir("")) // 空串=主目录
        incoming.filterIsInstance<HostMsg.Dir>().collect { d ->
            path = d.path; parent = d.parent; entries = d.entries; filter = ""
        }
    }

    val isDrives = path == "::drives"
    val shown = entries.filter { it.contains(filter, ignoreCase = true) }
    val sep = if (path.contains("\\")) "\\" else "/"
    fun child(name: String) = if (path.endsWith(sep)) path + name else path + sep + name
    // 磁盘列表层：entries 已是完整盘根，直接用；普通层：拼接为子路径
    fun targetFor(name: String) = if (isDrives) name else child(name)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("选择目录", maxLines = 1) },
        text = {
            Column(Modifier.height(420.dp)) {
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Text(
                        if (isDrives) "此电脑（选择磁盘）" else path.ifBlank { "加载中…" },
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 2, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = { send(ClientMsg.ListDir("::drives")) }) { Text("磁盘") }
                }
                Spacer(Modifier.height(6.dp))
                if (!isDrives) {
                    OutlinedTextField(
                        value = filter,
                        onValueChange = { filter = it },
                        label = { Text("筛选当前目录") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(6.dp))
                }
                LazyColumn(Modifier.weight(1f)) {
                    if (parent.isNotBlank() && parent != path) {
                        item {
                            Text("📁  ..", modifier = Modifier
                                .fillMaxWidth().clickable { send(ClientMsg.ListDir(parent)) }
                                .padding(vertical = 12.dp))
                            HorizontalDivider()
                        }
                    }
                    items(shown, key = { it }) { name ->
                        Text((if (isDrives) "💽  " else "📁  ") + name, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier
                                .fillMaxWidth().clickable { send(ClientMsg.ListDir(targetFor(name))) }
                                .padding(vertical = 12.dp))
                        HorizontalDivider()
                    }
                    if (shown.isEmpty()) {
                        item { Text("（无子目录）", color = Color.Gray, modifier = Modifier.padding(vertical = 12.dp)) }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { if (path.isNotBlank() && !isDrives) onConfirm(path) }) { Text("在此新建") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}
