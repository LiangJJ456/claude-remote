package com.claude.remote.data

data class Session(
    val id: String,
    val name: String,
    val cwd: String,
    val state: String,   // working | waiting | exited
    val createdAt: String,
    val orphaned: Boolean,
)
