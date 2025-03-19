import crypto from 'crypto'
import express from 'express'
import bodyParser from 'body-parser'
import sha1 from 'sha1'
import xml2js from 'xml2js'
import { CozeClient } from './coze_client.mjs'
import dotenv from 'dotenv'

// 加载环境变量
dotenv.config()

const token = process.env.WECHAT_TOKEN
const encodingAESKey = process.env.WECHAT_ENCODING_AES_KEY
const corpid = process.env.WECHAT_CORP_ID
const corpsecret = process.env.WECHAT_CORP_SECRET

const coze_token = process.env.COZE_TOKEN
const coze_bot_id = process.env.COZE_BOT_ID

// access_token缓存
let accessTokenCache = {
  token: null,
  expiresAt: 0
}

const app = express()

// 配置body-parser
app.use(bodyParser.text({ 
  type: ['application/xml', 'text/xml', 'text/plain'],
  limit: '1mb',
  verify: (req, res, buf) => {
    console.log("\nbody-parser verify:")
    console.log("原始buffer:", buf)
    console.log("buffer长度:", buf.length)
    req.rawBody = buf
    console.log("转换后的rawBody:", req.rawBody)
  }
}))

// 验证URL有效性
app.get('/wechat/coze', (req, res) => {
  const { msg_signature, timestamp, nonce, echostr } = req.query
  
  // 1. 对收到的请求做Urldecode处理
  const decodedEchostr = decodeURIComponent(echostr)
  
  // 2. 将token、timestamp、nonce、msg_encrypt四个参数按照字典序排序
  const arr = [token, timestamp, nonce, decodedEchostr].sort()
  
  // 3. 将四个参数字符串拼接成一个字符串进行sha1加密
  const str = arr.join('')
  const signature = sha1(str)
  
  console.log("计算得到的签名:", signature)
  console.log("收到的签名:", msg_signature)
  
  // 4. 验证签名
  if (msg_signature === signature) {
    // 5. 解密echostr得到消息内容
    const decryptedEchostr = decrypt(decodedEchostr)
    
    // 6. 直接返回解密后的明文消息内容(不加引号,不带bom头,不带换行符)
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.send(decryptedEchostr)
  } else {
    console.log("签名验证失败")
    res.status(403).send('签名验证失败')
  }
})

// 解密函数
function decrypt(encrypted) {
  // 1. 对密文base64解码
  const aesMsg = Buffer.from(encrypted, 'base64')
  
  // 2. 使用AESKey做AES-256-CBC解密
  const key = Buffer.from(encodingAESKey + '=', 'base64')
  const iv = key.slice(0, 16)
  
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
  decipher.setAutoPadding(true)
  
  let decrypted = decipher.update(aesMsg)
  decrypted = Buffer.concat([decrypted, decipher.final()])
  
  // 3. 去掉rand_msg头部的16个随机字节
  const content = decrypted.slice(16)
  
  // 4. 获取消息长度(4字节,网络字节序)
  const msgLen = content.readInt32BE(0)
  
  // 5. 获取消息内容
  const msg = content.slice(4, msgLen + 4)
  
  // 6. 获取receiveid
  const receiveid = content.slice(msgLen + 4)
  
  // 7. 验证receiveid
  console.log("解密得到的receiveid:", receiveid.toString())
  console.log("期望的corpid:", corpid)
  
  if (receiveid.toString() !== corpid) {
    throw new Error('receiveid验证失败')
  }
  
  return msg.toString()
}

// 加密函数
function encrypt(message) {
  // 1. 生成16位随机字符串
  const random = crypto.randomBytes(16)
  
  // 2. 获取消息长度(4字节,网络字节序)
  const msgLen = Buffer.alloc(4)
  msgLen.writeInt32BE(message.length)
  
  // 3. 拼接消息
  const msg = Buffer.concat([
    random,
    msgLen,
    Buffer.from(message),
    Buffer.from(corpid)
  ])
  
  // 4. 使用AESKey做AES-256-CBC加密
  const key = Buffer.from(encodingAESKey + '=', 'base64')
  const iv = key.slice(0, 16)
  
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  cipher.setAutoPadding(true)
  
  let encrypted = cipher.update(msg)
  encrypted = Buffer.concat([encrypted, cipher.final()])
  
  // 5. 对密文base64编码
  return encrypted.toString('base64')
}

// 创建 Coze 客户端
const cozeClient = new CozeClient(coze_token)

// 接收消息和事件
app.post('/wechat/coze', async (req, res) => {
  // 打印完整的请求信息
  console.log("收到新的请求:")
  console.log("请求URL:", req.url)
  console.log("请求方法:", req.method)
  console.log("请求头:", req.headers)
  console.log("请求参数:", req.query)
  console.log("原始请求体:", req.body)
  console.log("rawBody:", req.rawBody)
  
  const { msg_signature, timestamp, nonce } = req.query
  const xml = req.body // 直接使用req.body,因为我们已经用text()解析了
  
  // 使用一个标志来跟踪是否已经发送了响应
  let hasResponded = false
  
  try {
    // 打印收到的原始数据
    console.log("\n处理消息:")
    console.log("query参数:", { msg_signature, timestamp, nonce })
    console.log("body内容:", xml)
    
    if (!xml) {
      console.error("错误: 请求体为空")
      throw new Error("请求体为空")
    }
    
    // 1. 解析XML消息获取Encrypt字段
    console.log("\n开始解析XML...")
    const result = await parseXML(xml)
    console.log("解析后的XML:", JSON.stringify(result, null, 2))
    
    const message = result.xml
    const encryptedMsg = message.Encrypt[0]
    console.log("提取的Encrypt字段:", encryptedMsg)
    
    // 2. 验证签名 (需要包含msg_encrypt)
    const arr = [token, timestamp, nonce, encryptedMsg].sort()
    const str = arr.join('')
    const signature = sha1(str)
    
    console.log("签名验证参数:", {
      token,
      timestamp,
      nonce,
      encryptedMsg,
      sortedArr: arr,
      signatureStr: str,
      calculatedSignature: signature,
      receivedSignature: msg_signature
    })
    
    if (msg_signature !== signature) {
      throw new Error('签名验证失败')
    }
    
    // 3. 解密消息
    console.log("开始解密消息...")
    const decrypted = decrypt(encryptedMsg)
    console.log("解密后的消息:", decrypted)
    
    // 4. 解析解密后的消息
    console.log("开始解析解密后的XML...")
    const decryptedResult = await parseXML(decrypted)
    console.log("解密后的XML解析结果:", JSON.stringify(decryptedResult, null, 2))
    
    const decryptedMessage = decryptedResult.xml
    
    // 5. 根据消息类型处理
    const msgType = decryptedMessage.MsgType[0]
    console.log("消息类型:", msgType)
    
    // 先发送成功响应，避免微信服务器重试
    const successReply = 'success'
    const encryptedReply = encrypt(successReply)
    const finalReply = `<xml>
      <Encrypt><![CDATA[${encryptedReply}]]></Encrypt>
      <MsgSignature><![CDATA[${msg_signature}]]></MsgSignature>
      <TimeStamp>${timestamp}</TimeStamp>
      <Nonce><![CDATA[${nonce}]]></Nonce>
    </xml>`
    
    console.log("发送成功响应")
    res.send(finalReply)
    hasResponded = true

    // 异步处理消息
    setImmediate(async () => {
      try {
        // 先发送等待提示消息
        const accessToken = await getAccessToken()
        const waitingMessage = {
          touser: decryptedMessage.FromUserName[0],
          msgtype: "text",
          agentid: parseInt(decryptedMessage.AgentID[0]),
          text: {
            content: "您的消息正在处理中，请耐心等待约1分钟..."
          }
        }

        // 发送等待提示
        const waitingResponse = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(waitingMessage)
        })

        const waitingResult = await waitingResponse.json()
        console.log("等待提示发送结果:", waitingResult)

        // 处理实际消息
        let replyMessage = ''
        switch(msgType) {
          case 'text':
            replyMessage = await handleTextMessage(decryptedMessage)
            break
          case 'event':
            replyMessage = handleEventMessage(decryptedMessage)
            break
          default:
            replyMessage = '暂不支持该类型消息'
        }
        
        console.log("异步处理完成，回复消息:", replyMessage)
      } catch (error) {
        console.error('异步处理消息失败:', error)
      }
    })
    
  } catch (error) {
    console.error('\n处理消息失败:')
    console.error('错误类型:', error.constructor.name)
    console.error('错误信息:', error.message)
    console.error('错误堆栈:', error.stack)
    if (!hasResponded) {
      res.status(500).send('处理消息失败')
    }
  }
})

// 解析XML
function parseXML(xml) {
  return new Promise((resolve, reject) => {
    xml2js.parseString(xml, (err, result) => {
      if (err) {
        reject(err)
      } else {
        resolve(result)
      }
    })
  })
}

// 处理文本消息
async function handleTextMessage(message) {
  const content = message.Content[0]
  const fromUser = message.FromUserName[0]
  const toUser = message.ToUserName[0]
  const agentId = message.AgentID[0]
  
  try {
    console.log('开始处理文本消息:', {
      content,
      fromUser,
      toUser,
      agentId
    })

    // 调用 Coze API
    const cozeResponse = await cozeClient.chat(content, coze_bot_id, {
      user_id: fromUser,
      meta_data: {
        from_user: fromUser,
        to_user: toUser,
        agent_id: agentId
      }
    })

    console.log('Coze API 响应:', cozeResponse)

    // 从消息列表中获取助手的回复
    const assistantMessages = cozeResponse.messages.filter(msg => 
      msg.role === 'assistant' && msg.type === 'answer'
    )

    if (!assistantMessages.length) {
      throw new Error('未找到助手回复')
    }

    // 获取最后一条回复并转换为微信支持的 markdown 格式
    let reply = assistantMessages[assistantMessages.length - 1].content
    
    // 转换 markdown 格式
    // 1. 替换不支持的语法
    reply = reply
      // 移除代码块语言标识
      .replace(/```[a-z]*\n/g, '`')
      // 替换结束的代码块标记
      .replace(/```/g, '`')
      // 替换粗体语法（保持微信支持的写法）
      .replace(/\*\*(.+?)\*\*/g, '**$1**')
      // 替换链接语法（保持微信支持的写法）
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1]($2)')
      // 替换引用语法（保持微信支持的写法）
      .replace(/^> (.+)$/gm, '> $1')
      // 替换标题语法（保持微信支持的写法）
      .replace(/^(#{1,6}) (.+)$/gm, '$1 $2')

    // 分段发送消息
    const segments = splitMessage(reply)
    console.log(`消息将分为 ${segments.length} 段发送`)

    // 获取access_token
    const accessToken = await getAccessToken()

    // 依次发送每段消息
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      // 如果不是第一段，添加序号标记
      const content = segments.length > 1 ? `[${i + 1}/${segments.length}]\n${segment}` : segment

      // 构建发送消息的请求体
      const requestBody = {
        touser: fromUser,
        msgtype: "markdown",
        agentid: parseInt(agentId),
        markdown: {
          content: content
        }
      }

      // 发送消息
      const sendResponse = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      })

      const result = await sendResponse.json()
      console.log(`第 ${i + 1} 段消息发送结果:`, result)

      if (result.errcode !== 0) {
        throw new Error(`发送第 ${i + 1} 段消息失败: ${result.errmsg}`)
      }

      // 如果还有下一段，等待一小段时间再发送
      if (i < segments.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    return "消息发送成功"
  } catch (error) {
    console.error("处理消息错误:", error)
    throw error
  }
}

// 获取access_token
async function getAccessToken() {
  try {
    // 检查缓存是否有效（提前5分钟过期）
    const now = Date.now()
    if (accessTokenCache.token && accessTokenCache.expiresAt > now + 300000) {
      console.log("使用缓存的access_token")
      return accessTokenCache.token
    }
    
    console.log("重新获取access_token")
    const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpid}&corpsecret=${corpsecret}`)
    const result = await response.json()
    
    if (result.errcode === 0) {
      // 更新缓存
      accessTokenCache = {
        token: result.access_token,
        expiresAt: now + (result.expires_in * 1000)
      }
      console.log("access_token已更新，有效期:", result.expires_in, "秒")
      return result.access_token
    } else {
      throw new Error(`获取access_token失败: ${result.errmsg}`)
    }
  } catch (error) {
    console.error("获取access_token错误:", error)
    throw error
  }
}

// 处理事件消息
function handleEventMessage(message) {
  const event = message.Event[0]
  switch(event) {
    case 'subscribe':
      return '感谢关注!'
    default:
      return '收到事件消息'
  }
}

// 添加分段函数
function splitMessage(message) {
  const MAX_BYTES = 2000 // 预留一些空间给序号标记
  const segments = []
  let currentSegment = ''
  
  // 按行分割消息
  const lines = message.split('\n')
  
  for (const line of lines) {
    // 计算当前行的字节长度
    const lineBytes = Buffer.from(line, 'utf-8').length
    const currentSegmentBytes = Buffer.from(currentSegment, 'utf-8').length
    const newLineBytes = Buffer.from('\n', 'utf-8').length
    
    // 如果当前行加上换行符会超出限制
    if (currentSegmentBytes + lineBytes + newLineBytes > MAX_BYTES) {
      // 如果当前行本身就超过限制，需要按字符分割
      if (lineBytes > MAX_BYTES) {
        let temp = ''
        for (const char of line) {
          const charBytes = Buffer.from(char, 'utf-8').length
          if (Buffer.from(temp + char, 'utf-8').length > MAX_BYTES) {
            segments.push(temp)
            temp = char
          } else {
            temp += char
          }
        }
        if (temp) {
          currentSegment = temp
        }
      } else {
        // 当前段已经足够长，保存并开始新的段
        if (currentSegment) {
          segments.push(currentSegment)
        }
        currentSegment = line
      }
    } else {
      // 添加当前行到当前段
      currentSegment = currentSegment ? currentSegment + '\n' + line : line
    }
  }
  
  // 添加最后一段
  if (currentSegment) {
    segments.push(currentSegment)
  }
  
  return segments
}

// 启动服务器
const port = process.env.PORT || 3001
app.listen(port, () => {
  console.log(`服务器运行在 http://localhost:${port}`)
})