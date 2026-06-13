package com.claude.remote.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claude.remote.data.HostEntry

/** 电脑管理：列出所有电脑，点击编辑，右下角新增。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HostsScreen(
    hosts: List<HostEntry>,
    connStateOf: (String) -> String,
    onEdit: (HostEntry) -> Unit,
    onAdd: () -> Unit,
    onBack: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("电脑") },
                navigationIcon = { TextButton(onClick = onBack) { Text("返回") } },
            )
        },
        floatingActionButton = { FloatingActionButton(onClick = onAdd) { Text("+") } },
    ) { pad ->
        LazyColumn(Modifier.padding(pad).fillMaxSize()) {
            items(hosts, key = { it.id }) { h ->
                ListItem(
                    headlineContent = { Text(h.name) },
                    supportingContent = { Text(h.url, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    trailingContent = { Text(connStateOf(h.id)) },
                    modifier = Modifier.clickable { onEdit(h) },
                )
                HorizontalDivider()
            }
            if (hosts.isEmpty()) {
                item { Text("还没有电脑，点右下角 + 新增", modifier = Modifier.padding(16.dp)) }
            }
        }
    }
}
