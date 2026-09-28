import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplicationContext, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../../config/domains/app.config';
import { JWT_ALGORITHM, JwtConfig } from '../../config/domains/jwt.config';
import { PrismaService } from '../../prisma/prisma.service';
import { SocketSessionService } from './socket-session.service';

export class AuthenticatedIoAdapter extends IoAdapter {
  private readonly logger = new Logger(AuthenticatedIoAdapter.name);
  private readonly jwtService: JwtService;
  private readonly appConfig: AppConfig;
  private readonly jwtConfig: JwtConfig;
  private readonly prisma: PrismaService;
  private readonly sessionService: SocketSessionService;

  constructor(private app: INestApplicationContext) {
    super(app);
    this.jwtService = app.get(JwtService);
    this.appConfig = app.get(AppConfig);
    this.jwtConfig = app.get(JwtConfig);
    this.prisma = app.get(PrismaService);
    this.sessionService = app.get(SocketSessionService);
  }

  createIOServer(port: number, options?: any): Server {
    const frontendUrl = this.appConfig.frontendUrl;
    const origins = frontendUrl.split(',').map((s: string) => s.trim());
    
    options = {
      ...options,
      cors: {
        origin: origins,
        credentials: true,
      }
    };
    const server: Server = super.createIOServer(port, options);

    // This middleware intercepts ALL connections before they reach the Gateway
    server.use(async (socket: Socket, next) => {
      try {
        const token =
          socket.handshake.auth?.token ||
          socket.handshake.headers?.authorization?.replace('Bearer ', '');

        if (!token) {
          this.logger.warn(`Connection rejected: Missing token`);
          return next(new Error('Authentication Error: Missing token'));
        }

        // Verify JWT Signature
        const payload = this.jwtService.verify(token, {
          secret: this.jwtConfig.jwtSecret,
          algorithms: [JWT_ALGORITHM],
        });

        if (!payload || !payload.sub || !payload.shopId) {
          this.logger.warn(`Connection rejected: Invalid token payload`);
          return next(new Error('Authentication Error: Invalid token'));
        }

        const userId = payload.sub;
        const shopId = payload.shopId;
        const tokenVersion = payload.tokenVersion;

        // Perform Zero Trust check against Database
        const user = await this.prisma.user.findUnique({
          where: { id: userId, isDeleted: false },
          select: { isActive: true, tokenVersion: true, role: true },
        });

        if (!user) {
          return next(new Error('Authentication Error: User not found or deleted'));
        }
        // A brute-force lock blocks new logins only; it does not drop live sockets (P1-4).
        if (!user.isActive) {
          return next(new Error('Authentication Error: Account suspended or locked'));
        }
        if (user.tokenVersion !== tokenVersion) {
          return next(new Error('Authentication Error: Session revoked'));
        }

        const shop = await this.prisma.shop.findUnique({
          where: { id: shopId },
          select: { status: true, isDeleted: true },
        });

        if (!shop || shop.isDeleted) {
          return next(new Error('Authentication Error: Shop deleted'));
        }
        if (shop.status !== 'ACTIVE') {
          return next(new Error('Authentication Error: Shop suspended'));
        }

        // Safely attach ambient context properties to socket.data
        // These are guaranteed cryptographically & verified against DB
        socket.data.userId = userId;
        socket.data.shopId = shopId;
        socket.data.role = user.role;
        socket.data.correlationId = socket.handshake.headers['x-correlation-id'] || `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        
        // Register connection for session revocation
        this.sessionService.registerSocket(userId, socket);

        // Force deterministic room joins based solely on validated server context
        void socket.join(`tenant:${shopId}`);
        
        next();
      } catch (error: any) {
        this.logger.warn(`Connection rejected: ${error.message}`);
        next(new Error('Authentication Error: Unauthorized'));
      }
    });

    return server;
  }
}
