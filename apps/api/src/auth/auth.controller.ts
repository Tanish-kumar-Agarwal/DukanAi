import { Body, Controller, Get, Post, Request, UseGuards, Delete, Param, Ip, Headers } from '@nestjs/common';
import { LocalAuthGuard } from './local-auth.guard';
import { AuthService, LoginResponseDto } from './auth.service';
import { Public } from './public.decorator';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { SafeUserDto } from '../users/dto/safe-user.dto';
import type { Request as ExpressRequest } from 'express';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { GoogleIdentityService } from './google-identity.service';
import { AnyAuthenticated } from './/any-authenticated.decorator';

interface AuthenticatedRequest extends ExpressRequest {
  user: SafeUserDto;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly googleIdentityService: GoogleIdentityService,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new user (defaults to CASHIER role for security)' })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({ status: 201, type: SafeUserDto })
  async register(@Body() body: CreateUserDto): Promise<SafeUserDto> {
    // Security: force default role to CASHIER (least privilege) inside usersService.
    // DTO mass assignment protection strips unknown fields.
    const safeBody: CreateUserDto = {
      email: body.email,
      password: body.password,
      name: body.name,
      shopName: body.shopName,
    };

    return this.usersService.create(safeBody);
  }

  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @ApiOperation({ summary: 'Login with email and password' })
  async login(@Request() req: AuthenticatedRequest, @Ip() ip: string, @Headers('user-agent') userAgent: string): Promise<LoginResponseDto> {
    return this.authService.login(req.user, ip, userAgent);
  }

  @Public()
  @Post('google')
  @ApiOperation({ summary: 'Authenticate or register via Google OAuth' })
  @ApiBody({ type: GoogleAuthDto })
  @ApiResponse({ status: 200, type: SafeUserDto })
  async googleAuth(
    @Body() body: GoogleAuthDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ): Promise<LoginResponseDto> {
    const identity = await this.googleIdentityService.verifyIdToken(body.idToken);
    const user = await this.usersService.findOrCreateGoogleUser(identity.googleId, identity.email, identity.name);
    return this.authService.login(user, ip, userAgent);
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiBody({ schema: { type: 'object', properties: { refresh_token: { type: 'string' } } } })
  @ApiResponse({ status: 200, type: SafeUserDto })
  async refresh(
    @Body('refresh_token') refreshToken: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ): Promise<LoginResponseDto> {
    return this.authService.refresh(refreshToken, ip, userAgent);
  }

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all active sessions for the current user' })
  getSessions(@Request() req: AuthenticatedRequest) {
    return this.authService.getSessions(req.user.id);
  }

  @AnyAuthenticated()
  @Delete('sessions/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a specific session' })
  revokeSession(@Request() req: AuthenticatedRequest, @Param('id') sessionId: string) {
    return this.authService.revokeSession(sessionId, req.user.id);
  }

  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, type: SafeUserDto })
  getProfile(@Request() req: AuthenticatedRequest): SafeUserDto {
    return req.user;
  }
}
