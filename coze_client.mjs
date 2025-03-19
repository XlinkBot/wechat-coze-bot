export class CozeClient {
  constructor(token) {
    this.token = token
    this.baseUrl = 'https://api.coze.cn/v3'
  }

  // 发起对话
  async chat(message, botId, options = {}) {
    const url = `${this.baseUrl}/chat`
    const headers = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }

    // 构建请求体
    const requestBody = {
      bot_id: botId,
      user_id: options.user_id || 'default_user',
      stream: false, // 企业微信不支持流式响应，强制设置为 false
      auto_save_history: true, // 必须为 true，否则无法获取消息详情
      additional_messages: [
        {
          role: 'user',
          content: message,
          content_type: 'text',
          type: 'question'
        }
      ]
    }

    // 添加可选参数
    if (options.conversation_id) {
      requestBody.conversation_id = options.conversation_id
    }
    if (options.custom_variables) {
      requestBody.custom_variables = options.custom_variables
    }
    if (options.meta_data) {
      requestBody.meta_data = options.meta_data
    }
    if (options.extra_params) {
      requestBody.extra_params = options.extra_params
    }
    if (options.shortcut_command) {
      requestBody.shortcut_command = options.shortcut_command
    }

    // 构建 URL
    const queryParams = new URLSearchParams()
    if (options.conversation_id) {
      queryParams.append('conversation_id', options.conversation_id)
    }
    const fullUrl = `${url}${queryParams.toString() ? '?' + queryParams.toString() : ''}`

    try {
      console.log('发送对话请求到 Coze API:', {
        url: fullUrl,
        headers,
        body: requestBody
      })

      const response = await fetch(fullUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      })

      console.log('Coze API 响应状态:', response.status)
      console.log('Coze API 响应头:', Object.fromEntries(response.headers.entries()))
      
      const responseText = await response.text()
      console.log('Coze API 响应内容:', responseText)

      if (!response.ok) {
        throw new Error(`Coze API 请求失败: ${response.status} ${response.statusText}\n响应内容: ${responseText}`)
      }

      const data = JSON.parse(responseText)
      
      // 检查响应状态
      if (data.code !== 0) {
        throw new Error(`Coze API 返回错误: ${data.msg}`)
      }

      // 获取对话ID和会话ID
      const chatId = data.data.id
      const conversationId = data.data.conversation_id

      // 等待对话完成
      const chatResult = await this.waitForChatComplete(chatId, conversationId)

      // 获取对话消息详情
      const messages = await this.getChatMessages(chatId, conversationId)

      return {
        chat: chatResult,
        messages: messages
      }

    } catch (error) {
      console.error('Coze API 调用错误:', error)
      throw error
    }
  }

  // 等待对话完成
  async waitForChatComplete(chatId, conversationId, maxRetries = 30, retryInterval = 5000) {
    console.log(`等待对话完成: chatId=${chatId}, conversationId=${conversationId}`)
    
    let retryCount = 0
    while (retryCount < maxRetries) {
      try {
        const status = await this.getChatStatus(chatId, conversationId)
        console.log(`第 ${retryCount + 1} 次查询状态:`, status)

        // 根据状态进行处理
        switch (status.status) {
          case 'completed':
            return status
          case 'failed':
            throw new Error(`对话失败: ${status.last_error?.msg || '未知错误'}`)
          case 'requires_action':
            throw new Error(`对话需要额外操作: ${JSON.stringify(status.required_action)}`)
          case 'canceled':
            throw new Error('对话已取消')
          case 'created':
          case 'in_progress':
            // 继续等待
            await new Promise(resolve => setTimeout(resolve, retryInterval))
            retryCount++
            break
          default:
            throw new Error(`未知的对话状态: ${status.status}`)
        }
      } catch (error) {
        console.error('查询对话状态失败:', error)
        throw error
      }
    }

    throw new Error('对话处理超时')
  }

  // 获取对话状态
  async getChatStatus(chatId, conversationId) {
    const url = `${this.baseUrl}/chat/retrieve`
    const queryParams = new URLSearchParams({
      chat_id: chatId,
      conversation_id: conversationId
    })

    const response = await fetch(`${url}?${queryParams.toString()}`, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`获取对话状态失败: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    if (data.code !== 0) {
      throw new Error(`获取对话状态错误: ${data.msg}`)
    }

    return data.data
  }

  // 获取对话消息详情
  async getChatMessages(chatId, conversationId) {
    const url = `${this.baseUrl}/chat/message/list`
    const queryParams = new URLSearchParams({
      chat_id: chatId,
      conversation_id: conversationId
    })

    const response = await fetch(`${url}?${queryParams.toString()}`, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`获取对话消息失败: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    if (data.code !== 0) {
      throw new Error(`获取对话消息错误: ${data.msg}`)
    }

    return data.data
  }

  // 处理流式响应
  async handleStreamResponse(stream, onMessage) {
    const reader = stream.getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(line => line.trim() !== '')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') {
              continue
            }
            try {
              const parsed = JSON.parse(data)
              if (parsed.choices && parsed.choices[0].delta.content) {
                await onMessage(parsed.choices[0].delta.content)
              }
            } catch (e) {
              console.error('解析流式响应数据失败:', e)
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }
} 