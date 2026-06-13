package com.claude.remote.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.claude.remote.data.Session

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionListScreen(
    sessions: List<Session>,
    connState: String,
    onOpen: (Session) -> Unit,
    onNew: () -> Unit,
    onSettings: () -> Unit,
) {
    Scaffold(
        topBar = { TopAppBar(title = { Text("会话 · $connState") }, actions = {
            TextButton(onClick = onSettings) { Text("设置") }
        }) },
        floatingActionButton = { FloatingActionButton(onClick = onNew) { Text("+") } },
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
}
