type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type RequestOptions = {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: JsonValue;
    expectedStatus?: number;
    token?: string;
    cookie?: string;
    headers?: Record<string, string>;
    redirect?: RequestRedirect;
};

type AuthContext = {
    token?: string;
    cookie?: string;
};

type MessageListResponse = {
    messages: MessengerMessage[];
    total: number;
};

type MembersResponse = {
    members: MemberRecord[];
    myRole: string;
};

type CountResponse = {
    count: number;
};

type ChatSummary = {
    id: string;
    unread_count?: number;
    type?: 'direct' | 'group';
    name?: string | null;
    chat_participants?: MemberRecord[];
};

type MessageRecord = {
    id: string;
    chat_id: string;
    content: string | null;
    attachments?: AttachmentRecord[];
};

type AttachmentRecord = {
    name?: string;
    path?: string;
    type?: string;
    size?: number;
};

type MemberRecord = {
    user_id: number;
    role?: string;
    managers?: {
        id?: number;
        first_name?: string | null;
        last_name?: string | null;
        username?: string | null;
    } | null;
};

type AuthMeResponse = {
    authenticated: boolean;
    user?: {
        retail_crm_manager_id?: number | null;
    };
};

type AttachmentUploadResponse = {
    upload_url: string;
    file_path: string;
    token?: string;
};

const baseUrl = process.env.MESSENGER_BASE_URL;
const bearerToken = process.env.MESSENGER_BEARER_TOKEN;
const secondBearerToken = process.env.MESSENGER_SECOND_BEARER_TOKEN;
const loginUsername = process.env.MESSENGER_LOGIN;
const loginPassword = process.env.MESSENGER_PASSWORD;
const secondLoginUsername = process.env.MESSENGER_SECOND_LOGIN;
const secondLoginPassword = process.env.MESSENGER_SECOND_PASSWORD;
const chatId = process.env.MESSENGER_CHAT_ID;
const removedOrForeignChatId = process.env.MESSENGER_FORBIDDEN_CHAT_ID;
const directParticipantId = parseOptionalInt(process.env.MESSENGER_DIRECT_PARTICIPANT_ID);
const groupParticipantIds = parseIntList(process.env.MESSENGER_GROUP_PARTICIPANT_IDS);
const groupExtraParticipantId = parseOptionalInt(process.env.MESSENGER_GROUP_EXTRA_PARTICIPANT_ID);
const enableMutationChecks = process.env.MESSENGER_ENABLE_MUTATION_CHECKS !== 'false';
const messagePrefix = process.env.MESSENGER_TEST_MESSAGE_PREFIX || '[messenger-api-smoke]';

if (!baseUrl) {
    throw new Error('MESSENGER_BASE_URL is required');
}

if (!bearerToken && !(loginUsername && loginPassword)) {
    throw new Error('Either MESSENGER_BEARER_TOKEN or MESSENGER_LOGIN + MESSENGER_PASSWORD is required');
}

function buildUrl(path: string) {
    return new URL(path, baseUrl).toString();
}

function parseOptionalInt(value: string | undefined) {
    if (!value) {
        return null;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseIntList(value: string | undefined) {
    if (!value) {
        return [] as number[];
    }

    return value
        .split(',')
        .map((item) => Number.parseInt(item.trim(), 10))
        .filter((item) => Number.isFinite(item));
}

async function requestJson(path: string, options: RequestOptions = {}) {
    const response = await fetch(buildUrl(path), {
        method: options.method || 'GET',
        headers: {
            ...(options.token || bearerToken ? { Authorization: `Bearer ${options.token || bearerToken}` } : {}),
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.cookie ? { Cookie: options.cookie } : {}),
            ...options.headers,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        redirect: options.redirect,
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) as JsonValue : null;
    const expectedStatus = options.expectedStatus ?? 200;

    if (response.status !== expectedStatus) {
        throw new Error(`Unexpected status for ${path}: expected ${expectedStatus}, got ${response.status}. Body: ${text}`);
    }

    return data;
}

async function requestText(path: string, options: RequestOptions = {}) {
    const response = await fetch(buildUrl(path), {
        method: options.method || 'GET',
        headers: {
            ...(options.token || bearerToken ? { Authorization: `Bearer ${options.token || bearerToken}` } : {}),
            ...(options.cookie ? { Cookie: options.cookie } : {}),
            ...options.headers,
        },
        redirect: options.redirect,
    });

    const text = await response.text();
    const expectedStatus = options.expectedStatus ?? 200;
    if (response.status !== expectedStatus) {
        throw new Error(`Unexpected status for ${path}: expected ${expectedStatus}, got ${response.status}. Body: ${text}`);
    }

    return text;
}

function assertCondition(condition: unknown, message: string) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertMessageListResponse(value: JsonValue): asserts value is MessageListResponse {
    assertCondition(typeof value === 'object' && value !== null && 'messages' in value && Array.isArray((value as MessageListResponse).messages), 'Messages response must contain messages');
}

function assertMembersResponse(value: JsonValue): asserts value is MembersResponse {
    assertCondition(typeof value === 'object' && value !== null && 'members' in value && Array.isArray((value as MembersResponse).members), 'Members response must contain members');
}

function assertCountResponse(value: JsonValue): asserts value is CountResponse {
    assertCondition(typeof value === 'object' && value !== null && 'count' in value && typeof (value as CountResponse).count === 'number', 'Unread response must contain count');
}

function assertChatListResponse(value: JsonValue): asserts value is ChatSummary[] {
    assertCondition(Array.isArray(value), 'Chats response must be an array');
}

function assertMessageRecord(value: JsonValue): asserts value is MessageRecord {
    assertCondition(typeof value === 'object' && value !== null, 'Message response must be an object');
    assertCondition('id' in value && typeof (value as MessageRecord).id === 'string', 'Message response must contain id');
    assertCondition('chat_id' in value && typeof (value as MessageRecord).chat_id === 'string', 'Message response must contain chat_id');
}

function assertAttachmentUploadResponse(value: JsonValue): asserts value is AttachmentUploadResponse {
    assertCondition(typeof value === 'object' && value !== null, 'Attachment upload response must be an object');
    assertCondition('upload_url' in value && typeof (value as AttachmentUploadResponse).upload_url === 'string', 'Attachment upload response must contain upload_url');
    assertCondition('file_path' in value && typeof (value as AttachmentUploadResponse).file_path === 'string', 'Attachment upload response must contain file_path');
}

function assertAuthenticatedUser(value: JsonValue): asserts value is AuthMeResponse {
    assertCondition(typeof value === 'object' && value !== null, 'Auth me response must be an object');
    assertCondition('authenticated' in value && (value as AuthMeResponse).authenticated === true, 'Auth me response must be authenticated');
    assertCondition(typeof (value as AuthMeResponse).user?.retail_crm_manager_id === 'number', 'Auth me response must contain retail_crm_manager_id');
}

function findChat(chats: ChatSummary[], targetChatId: string) {
    return chats.find((chat) => chat.id === targetChatId) || null;
}

function getResponseCookies(response: Response) {
    const headersWithCookies = response.headers as Headers & {
        getSetCookie?: () => string[];
    };

    if (typeof headersWithCookies.getSetCookie === 'function') {
        return headersWithCookies.getSetCookie();
    }

    const singleHeader = response.headers.get('set-cookie');
    if (!singleHeader) {
        return [] as string[];
    }

    return singleHeader
        .split(/,(?=[^;,]+=)/)
        .map((value) => value.trim())
        .filter(Boolean);
}

function toCookieHeader(setCookieHeaders: string[]) {
    return setCookieHeaders
        .map((headerValue) => headerValue.split(';')[0]?.trim())
        .filter(Boolean)
        .join('; ');
}

async function loginWithPassword(username: string, password: string) {
    const response = await fetch(buildUrl('/api/auth/login'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Login failed for messenger smoke');
    }

    const cookieHeader = toCookieHeader(getResponseCookies(response));
    if (!cookieHeader) {
        throw new Error('Login succeeded but no auth cookies were returned');
    }

    return { cookie: cookieHeader } satisfies AuthContext;
}

async function resolveAuthContext(options: {
    token?: string;
    username?: string;
    password?: string;
}) {
    if (options.token) {
        return { token: options.token } satisfies AuthContext;
    }

    if (options.username && options.password) {
        return loginWithPassword(options.username, options.password);
    }

    return {} satisfies AuthContext;
}

async function getCurrentManagerId(auth: AuthContext) {
    const me = await requestJson('/api/auth/me', auth);
    assertAuthenticatedUser(me);
    return me.user?.retail_crm_manager_id as number;
}

async function createChat(options: {
    auth?: AuthContext;
    type: 'direct' | 'group';
    participantIds: number[];
    name?: string | null;
}) {
    const createdChat = await requestJson('/api/messenger/chats', {
        method: 'POST',
        ...options.auth,
        body: {
            type: options.type,
            name: options.type === 'group' ? options.name || 'Smoke Group' : null,
            participant_ids: options.participantIds,
        },
    });

    assertCondition(typeof createdChat === 'object' && createdChat !== null && 'id' in createdChat, 'Created chat must contain id');
    return createdChat as { id: string; type?: 'direct' | 'group'; name?: string | null };
}

async function fetchChats(auth?: AuthContext) {
    const chats = await requestJson('/api/messenger/chats', auth || {});
    assertChatListResponse(chats);
    return chats;
}

async function fetchMessages(chatIdValue: string, auth?: AuthContext, limit = 20) {
    const messages = await requestJson(`/api/messenger/messages?chat_id=${encodeURIComponent(chatIdValue)}&limit=${limit}&offset=0`, auth || {});
    assertMessageListResponse(messages);
    return messages;
}

async function fetchMembers(chatIdValue: string, auth?: AuthContext) {
    const members = await requestJson(`/api/messenger/chats/members?chat_id=${encodeURIComponent(chatIdValue)}`, auth || {});
    assertMembersResponse(members);
    return members;
}

async function createProbeAttachment(chatIdValue: string, auth?: AuthContext) {
    const attachmentMeta = await requestJson('/api/messenger/attachments', {
        method: 'POST',
        ...(auth || {}),
        body: {
            chat_id: chatIdValue,
            file_name: 'smoke-note.txt',
            file_type: 'text/plain',
            file_size: 26,
        },
    });
    assertAttachmentUploadResponse(attachmentMeta);

    const uploadResponse = await fetch(attachmentMeta.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: `smoke attachment ${Date.now()}`,
    });

    if (!uploadResponse.ok) {
        throw new Error(`Attachment upload failed with status ${uploadResponse.status}`);
    }

    return attachmentMeta;
}

async function runOptionalDirectFlow(primaryAuth: AuthContext, secondaryAuth: AuthContext, primaryUserId: number, secondaryUserId: number) {
    if ((!secondBearerToken && !(secondLoginUsername && secondLoginPassword)) || !directParticipantId) {
        console.log('Direct flow env not fully provided, extended direct-chat checks skipped');
        return;
    }

    assertCondition(directParticipantId === secondaryUserId, 'MESSENGER_DIRECT_PARTICIPANT_ID must match the second bearer token user');

    const probeContent = `${messagePrefix} direct ${new Date().toISOString()}`;
    const directChat = await createChat({
        auth: primaryAuth,
        type: 'direct',
        participantIds: [directParticipantId],
    });
    console.log(`Direct chat created or reused: ${directChat.id}`);

    const duplicateDirectChat = await createChat({
        auth: primaryAuth,
        type: 'direct',
        participantIds: [directParticipantId],
    });
    assertCondition(duplicateDirectChat.id === directChat.id, 'Duplicate direct chat should resolve to the existing chat');
    console.log(`Direct duplicate check passed for chat ${directChat.id}`);

    const sendDirectMessage = await requestJson('/api/messenger/messages', {
        method: 'POST',
        ...primaryAuth,
        body: { chat_id: directChat.id, content: probeContent },
    });
    assertMessageRecord(sendDirectMessage);
    console.log(`Direct message sent in chat ${directChat.id}`);

    const secondUserChats = await fetchChats(secondaryAuth);
    const secondUserDirectChat = findChat(secondUserChats, directChat.id);
    assertCondition(Boolean(secondUserDirectChat), 'Second user must see the created direct chat');
    assertCondition((secondUserDirectChat?.unread_count || 0) > 0, 'Second user should receive unread for the direct message');
    console.log(`Second user unread detected for direct chat ${directChat.id}`);

    const secondUserMessages = await fetchMessages(directChat.id, secondaryAuth);
    assertCondition(secondUserMessages.messages.some((message) => message.id === sendDirectMessage.id), 'Second user must be able to read the direct message history');
    console.log(`Second user can read direct chat ${directChat.id}`);

    const secondUserChatsAfterRead = await fetchChats(secondaryAuth);
    const secondUserDirectChatAfterRead = findChat(secondUserChatsAfterRead, directChat.id);
    assertCondition((secondUserDirectChatAfterRead?.unread_count || 0) === 0, 'Unread must reset after second user opens the direct chat');
    console.log(`Direct unread reset passed for chat ${directChat.id}`);

    const attachmentMeta = await createProbeAttachment(directChat.id, primaryAuth);
    const attachmentMessage = await requestJson('/api/messenger/messages', {
        method: 'POST',
        ...primaryAuth,
        body: {
            chat_id: directChat.id,
            content: `${messagePrefix} attachment ${new Date().toISOString()}`,
            attachments: [{
                name: 'smoke-note.txt',
                path: attachmentMeta.file_path,
                type: 'text/plain',
                size: 26,
            }],
        },
    });
    assertMessageRecord(attachmentMessage);
    console.log(`Attachment message sent in direct chat ${directChat.id}`);

    const downloadedByPrimary = await requestText(`/api/messenger/attachments?chat_id=${encodeURIComponent(directChat.id)}&path=${encodeURIComponent(attachmentMeta.file_path)}`, primaryAuth);
    assertCondition(downloadedByPrimary.includes('smoke attachment'), 'Primary user must be able to download the uploaded attachment');

    const downloadedBySecond = await requestText(`/api/messenger/attachments?chat_id=${encodeURIComponent(directChat.id)}&path=${encodeURIComponent(attachmentMeta.file_path)}`, {
        ...secondaryAuth,
    });
    assertCondition(downloadedBySecond.includes('smoke attachment'), 'Second user must be able to download the uploaded attachment');
    console.log(`Protected attachment download passed for both direct chat members ${directChat.id}`);

    await requestJson('/api/messenger/messages', {
        method: 'DELETE',
        ...primaryAuth,
        body: { message_id: attachmentMessage.id },
        expectedStatus: 200,
    });
    console.log(`Attachment cleanup passed for message ${attachmentMessage.id}`);

    assertCondition(primaryUserId !== secondaryUserId, 'Primary and secondary users must be different');
}

async function runOptionalGroupFlow(primaryAuth: AuthContext, secondaryAuth: AuthContext | null, primaryUserId: number, secondaryUserId: number | null) {
    if (groupParticipantIds.length === 0) {
        console.log('Group flow env not provided, extended group-chat checks skipped');
        return;
    }

    const groupName = `Smoke Group ${Date.now()}`;
    const groupChat = await createChat({
        auth: primaryAuth,
        type: 'group',
        participantIds: groupParticipantIds,
        name: groupName,
    });
    console.log(`Group chat created: ${groupChat.id}`);

    const initialMembers = await fetchMembers(groupChat.id, primaryAuth);
    assertCondition(initialMembers.members.length === groupParticipantIds.length + 1, 'Group members count mismatch after creation');

    const groupMessages = await fetchMessages(groupChat.id, primaryAuth);
    assertCondition(groupMessages.messages.some((message) => (message.content || '').includes('создал группу')), 'Group creation system message must exist');
    console.log(`Group creation system message verified for ${groupChat.id}`);

    const renamedGroupName = `${groupName} Renamed`;
    const renameResult = await requestJson('/api/messenger/chats', {
        method: 'PATCH',
        ...primaryAuth,
        body: { chat_id: groupChat.id, name: renamedGroupName },
    });
    assertCondition(typeof renameResult === 'object' && renameResult !== null && 'renamed' in renameResult, 'Group rename must succeed');

    const renamedGroupMessages = await fetchMessages(groupChat.id, primaryAuth);
    assertCondition(renamedGroupMessages.messages.some((message) => (message.content || '').includes('изменил название чата')), 'Group rename system message must exist');
    console.log(`Group rename passed for ${groupChat.id}`);

    if (groupExtraParticipantId && !groupParticipantIds.includes(groupExtraParticipantId)) {
        const addResult = await requestJson('/api/messenger/chats/members', {
            method: 'POST',
            ...primaryAuth,
            body: { chat_id: groupChat.id, user_id: groupExtraParticipantId },
        });
        assertCondition(typeof addResult === 'object' && addResult !== null && 'success' in addResult, 'Group add member must succeed');

        const membersAfterAdd = await fetchMembers(groupChat.id, primaryAuth);
        assertCondition(membersAfterAdd.members.some((member) => member.user_id === groupExtraParticipantId), 'Added participant must appear in group members');

        const removeResult = await requestJson('/api/messenger/chats/members', {
            method: 'DELETE',
            ...primaryAuth,
            body: { chat_id: groupChat.id, user_id: groupExtraParticipantId },
        });
        assertCondition(typeof removeResult === 'object' && removeResult !== null && 'success' in removeResult, 'Group remove member must succeed');

        const membersAfterRemove = await fetchMembers(groupChat.id, primaryAuth);
        assertCondition(!membersAfterRemove.members.some((member) => member.user_id === groupExtraParticipantId), 'Removed participant must disappear from group members');
        console.log(`Group add/remove member path passed for ${groupChat.id}`);
    }

    const deleteResult = await requestJson('/api/messenger/chats', {
        method: 'DELETE',
        ...primaryAuth,
        body: { chat_id: groupChat.id },
    });
    assertCondition(typeof deleteResult === 'object' && deleteResult !== null && 'deleted' in deleteResult, 'Group delete must succeed');

    await requestJson(`/api/messenger/messages?chat_id=${encodeURIComponent(groupChat.id)}&limit=5&offset=0`, {
        ...primaryAuth,
        expectedStatus: 403,
    });
    console.log(`Group delete cleanup passed for ${groupChat.id}`);

    if (!secondaryAuth || secondaryUserId === null || !groupParticipantIds.includes(secondaryUserId)) {
        console.log('Group leave/promote flow skipped: second bearer token is not part of MESSENGER_GROUP_PARTICIPANT_IDS');
        return;
    }

    const leaveChat = await createChat({
        auth: primaryAuth,
        type: 'group',
        participantIds: [secondaryUserId],
        name: `Smoke Leave ${Date.now()}`,
    });
    const leaveMembersBefore = await fetchMembers(leaveChat.id, primaryAuth);
    assertCondition(leaveMembersBefore.members.some((member) => member.user_id === primaryUserId), 'Primary user must be a member before leave flow');

    const leaveResult = await requestJson('/api/messenger/chats/members', {
        method: 'DELETE',
        ...primaryAuth,
        body: { chat_id: leaveChat.id, user_id: primaryUserId },
    });
    assertCondition(typeof leaveResult === 'object' && leaveResult !== null && 'left' in leaveResult, 'Admin leave flow must succeed');

    await requestJson(`/api/messenger/messages?chat_id=${encodeURIComponent(leaveChat.id)}&limit=5&offset=0`, {
        ...primaryAuth,
        expectedStatus: 403,
    });

    const secondUserMembersAfterLeave = await fetchMembers(leaveChat.id, secondaryAuth);
    assertCondition(secondUserMembersAfterLeave.myRole === 'admin', 'Remaining participant must be promoted to admin after the original admin leaves');

    await requestJson('/api/messenger/chats', {
        method: 'DELETE',
        ...secondaryAuth,
        body: { chat_id: leaveChat.id },
    });
    console.log(`Group leave/promote flow passed for ${leaveChat.id}`);
}

async function run() {
    console.log('Messenger API smoke check started');
    console.log(`Base URL: ${baseUrl}`);

    const primaryAuth = await resolveAuthContext({
        token: bearerToken,
        username: loginUsername,
        password: loginPassword,
    });
    const secondaryAuth = secondBearerToken || (secondLoginUsername && secondLoginPassword)
        ? await resolveAuthContext({
            token: secondBearerToken,
            username: secondLoginUsername,
            password: secondLoginPassword,
        })
        : null;

    const primaryUserId = await getCurrentManagerId(primaryAuth);
    const secondaryUserId = secondaryAuth ? await getCurrentManagerId(secondaryAuth) : null;
    console.log(`Primary manager id: ${primaryUserId}`);
    if (secondaryUserId !== null) {
        console.log(`Secondary manager id: ${secondaryUserId}`);
    }

    const chats = await requestJson('/api/messenger/chats', primaryAuth);
    assertChatListResponse(chats);
    console.log(`Chats loaded: ${chats.length}`);

    const unread = await requestJson('/api/messenger/chats?count=true', primaryAuth);
    assertCountResponse(unread);
    console.log(`Unread aggregate loaded: ${unread.count}`);

    if (chatId) {
        const messages = await requestJson(`/api/messenger/messages?chat_id=${encodeURIComponent(chatId)}&limit=10&offset=0`, primaryAuth);
        assertMessageListResponse(messages);
        console.log(`Messages loaded for chat ${chatId}`);

        const members = await requestJson(`/api/messenger/chats/members?chat_id=${encodeURIComponent(chatId)}`, primaryAuth);
        assertMembersResponse(members);
        console.log(`Members loaded for chat ${chatId}`);

        const markRead = await requestJson('/api/messenger/chats', {
            method: 'PATCH',
            ...primaryAuth,
            body: { chat_id: chatId },
            expectedStatus: 200,
        });
        assertCondition(typeof markRead === 'object' && markRead !== null && 'success' in markRead, 'Mark-read response must contain success');
        console.log(`Mark-read passed for chat ${chatId}`);

        const invalidEmptyMessage = await requestJson('/api/messenger/messages', {
            method: 'POST',
            ...primaryAuth,
            body: { chat_id: chatId, content: '   ' },
            expectedStatus: 400,
        });
        assertCondition(typeof invalidEmptyMessage === 'object' && invalidEmptyMessage !== null && 'error' in invalidEmptyMessage, 'Invalid empty message must be rejected');
        console.log(`Validation rejected empty message for chat ${chatId}`);

        const invalidAttachment = await requestJson('/api/messenger/messages', {
            method: 'POST',
            ...primaryAuth,
            body: {
                chat_id: chatId,
                attachments: [
                    {
                        name: 'bad.exe',
                        path: `${chatId}/bad.exe`,
                        type: 'application/x-msdownload',
                        size: 128,
                    },
                ],
            },
            expectedStatus: 400,
        });
        assertCondition(typeof invalidAttachment === 'object' && invalidAttachment !== null && 'error' in invalidAttachment, 'Invalid attachment type must be rejected');
        console.log(`Validation rejected unsupported attachment type for chat ${chatId}`);

        if (enableMutationChecks) {
            const probeContent = `${messagePrefix} ${new Date().toISOString()}`;
            const createdMessage = await requestJson('/api/messenger/messages', {
                method: 'POST',
                ...primaryAuth,
                body: { chat_id: chatId, content: probeContent },
                expectedStatus: 200,
            });
            assertMessageRecord(createdMessage);
            assertCondition(createdMessage.chat_id === chatId, 'Created message chat_id mismatch');
            assertCondition(createdMessage.content === probeContent, 'Created message content mismatch');
            console.log(`Message creation passed for chat ${chatId}`);

            const messagesAfterCreate = await requestJson(`/api/messenger/messages?chat_id=${encodeURIComponent(chatId)}&limit=20&offset=0`, primaryAuth);
            assertMessageListResponse(messagesAfterCreate);
            assertCondition(messagesAfterCreate.messages.some((message) => message.id === createdMessage.id), 'Created message not found in history');
            console.log(`Message history contains created probe message ${createdMessage.id}`);

            const deleteResult = await requestJson('/api/messenger/messages', {
                method: 'DELETE',
                ...primaryAuth,
                body: { message_id: createdMessage.id },
                expectedStatus: 200,
            });
            assertCondition(typeof deleteResult === 'object' && deleteResult !== null && 'deleted' in deleteResult, 'Delete response must contain deleted flag');
            console.log(`Message deletion passed for message ${createdMessage.id}`);

            const messagesAfterDelete = await requestJson(`/api/messenger/messages?chat_id=${encodeURIComponent(chatId)}&limit=20&offset=0`, primaryAuth);
            assertMessageListResponse(messagesAfterDelete);
            assertCondition(!messagesAfterDelete.messages.some((message) => message.id === createdMessage.id), 'Deleted message is still present in history');
            console.log(`Message history no longer contains deleted probe message ${createdMessage.id}`);
        } else {
            console.log('MESSENGER_ENABLE_MUTATION_CHECKS=false, mutation checks skipped');
        }
    } else {
        console.log('MESSENGER_CHAT_ID not provided, chat-specific checks skipped');
    }

    if (removedOrForeignChatId) {
        await requestJson(`/api/messenger/messages?chat_id=${encodeURIComponent(removedOrForeignChatId)}&limit=10&offset=0`, {
            ...primaryAuth,
            expectedStatus: 403,
        });
        console.log(`Forbidden access correctly rejected for chat ${removedOrForeignChatId}`);

        if (enableMutationChecks) {
            await requestJson('/api/messenger/messages', {
                method: 'POST',
                ...primaryAuth,
                body: { chat_id: removedOrForeignChatId, content: `${messagePrefix} forbidden ${new Date().toISOString()}` },
                expectedStatus: 403,
            });
            console.log(`Forbidden message creation correctly rejected for chat ${removedOrForeignChatId}`);
        }
    } else {
        console.log('MESSENGER_FORBIDDEN_CHAT_ID not provided, forbidden-path check skipped');
    }

    if (secondaryUserId !== null) {
        await runOptionalDirectFlow(primaryAuth, secondaryAuth as AuthContext, primaryUserId, secondaryUserId);
    } else {
        console.log('Second user auth not provided, two-user direct checks skipped');
    }

    await runOptionalGroupFlow(primaryAuth, secondaryAuth, primaryUserId, secondaryUserId);

    console.log('Messenger API smoke check completed successfully');
}

run().catch((error) => {
    console.error('Messenger API smoke check failed');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});