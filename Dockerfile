# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
FROM oven/bun:1 as base
COPY . .
ENTRYPOINT [ "bun", "run", "src/index.ts" ]

# docker run --name example-bun -p 7000:3000 example-bun