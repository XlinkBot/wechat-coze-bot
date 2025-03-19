# 使用 Node.js LTS 版本作为基础镜像
FROM --platform=linux/amd64 node:22-alpine

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json（如果存在）
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制源代码
COPY . .

# 暴露端口
EXPOSE 3001

# 启动命令
CMD ["npm", "start"]