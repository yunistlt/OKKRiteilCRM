import { supabase } from '@/utils/supabase';
import { logMessengerError } from '@/lib/messenger/logger';

/**
 * Utility for system bots to send messages to chats.
 * Uses service_role to bypass RLS.
 */
export async function sendSystemMessage(chatId: string, content: string, senderName: string) {
    try {
        // In the database, we might need a way to identify system messages.
        // For now, we'll use null sender_id and prefix content or use attachments for metadata.
        
        const { data, error } = await supabase
            .from('messages')
            .insert({
                chat_id: chatId,
                sender_id: null, // System bot
                content: `**${senderName}**: ${content}`,
                attachments: [
                    { type: 'system', bot_name: senderName }
                ]
            })
            .select()
            .single();

        if (error) throw error;

        // Update chat's updated_at to bring it to top
        await supabase
            .from('chats')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', chatId);

        return data;
    } catch (error) {
        logMessengerError('bot.sendSystemMessage', error, {
            chatId,
            details: { senderName },
        });
        throw error;
    }
}

/**
 * Finds or creates a direct chat between a bot and a manager.
 * This can be used for automated notifications.
 */
export async function getOrCreateBotChat(managerId: number, botName: string) {
    // 1. Check if a chat already exists with this manager specifically for notifications
    // We might want to tag chats or use a specific naming convention.
    // For now, let's look for a direct chat that includes this manager.
    // NOTE: True "direct" chats are between two managers. 
    // For bot-manager, we might use a group chat with a single participant or a custom type.
    
    // Simplification: use a group chat named after the bot.
    const { data: existingChat, error: searchError } = await supabase
        .from('chats')
        .select(`
            id,
            chat_participants!inner(user_id)
        `)
        .eq('type', 'group')
        .eq('name', botName)
        .eq('chat_participants.user_id', managerId)
        .maybeSingle();

    if (existingChat) return existingChat.id;

    // Create new
    const { data: newChat, error: createError } = await supabase
        .from('chats')
        .insert({
            type: 'group',
            name: botName
        })
        .select()
        .single();

    if (createError) throw createError;

    await supabase
        .from('chat_participants')
        .insert({
            chat_id: newChat.id,
            user_id: managerId,
            role: 'member'
        });

    return newChat.id;
}
